import { expect, test } from './support/fixtures.js';
import { diffFilesHtml, serveMergeRequest, startPageChurn, stopPageChurn, streamDiffFiles, viewedPaths } from './support/gitlab.js';

const CHURN_MS = 5000;
const LARGE_MERGE_REQUEST = Array.from({ length: 40 }, (_, i) => (i % 3 === 2 ? `src/P${i}/Code${i}.cs` : `src/P${i}/packages.P${i}.lock.json`));

function isExtensionFrame(node) {
  return node.callFrame.url.startsWith('chrome-extension://');
}

/**
 * Milliseconds of samples whose call stack passes through the extension, so DOM calls it makes count too.
 */
function extensionTimeMs(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map(profile.nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node.id])));
  const inExtension = new Map();

  function withinExtension(nodeId) {
    if (nodeId === undefined) return false;
    if (!inExtension.has(nodeId)) inExtension.set(nodeId, isExtensionFrame(nodes.get(nodeId)) || withinExtension(parents.get(nodeId)));
    return inExtension.get(nodeId);
  }

  return profile.samples.reduce((sum, nodeId, i) => (withinExtension(nodeId) ? sum + profile.timeDeltas[i] / 1000 : sum), 0);
}

/**
 * CPU time spent in the extension's own scripts on this page, from the V8 sampling profiler.
 */
async function profileExtension(page, during) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await during();
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.detach();

  const extensionMs = extensionTimeMs(profile);
  test.info().annotations.push({ type: 'extension CPU', description: `${extensionMs.toFixed(1)} ms` });
  return extensionMs;
}

async function churnFor(page, ms) {
  await startPageChurn(page);
  await page.waitForTimeout(ms);
  await stopPageChurn(page);
}

test.describe('performance on a 400k-node diffs page', () => {
  for (const view of ['rapid', 'classic']) {
    test(`first pass over the page stays short in the ${view} view`, async ({ context }) => {
      const url = await serveMergeRequest(context, { paths: LARGE_MERGE_REQUEST, lines: 2000, view });
      const page = await context.newPage();

      const extensionMs = await profileExtension(page, async () => {
        await page.goto(url);
        await expect.poll(async () => (await viewedPaths(page)).length).toBe(27);
      });

      expect(extensionMs).toBeLessThan(100);
    });
  }

  test('costs nothing once every lock file is ticked', async ({ context }) => {
    const url = await serveMergeRequest(context, { paths: LARGE_MERGE_REQUEST, lines: 2000 });
    const page = await context.newPage();
    await page.goto(url);
    await expect.poll(async () => (await viewedPaths(page)).length).toBe(27);

    const extensionMs = await profileExtension(page, () => churnFor(page, CHURN_MS));

    expect(extensionMs).toBeLessThan(5);
  });

  for (const view of ['rapid', 'classic']) {
    test(`stays cheap on a 1,000-file merge request while a matching file has not rendered yet in the ${view} view`, async ({ context }) => {
      const paths = Array.from({ length: 1000 }, (_, i) => (i % 200 === 0 ? `src/P${i}/packages.P${i}.lock.json` : `src/P${i}/Code${i}.cs`));
      const url = await serveMergeRequest(context, { paths: [...paths, 'web/pnpm-lock.yaml'], rendered: paths, lines: 5, view });
      const page = await context.newPage();
      await page.goto(url);
      await expect.poll(async () => (await viewedPaths(page)).length).toBe(5);

      const extensionMs = await profileExtension(page, () => churnFor(page, CHURN_MS));

      expect(extensionMs).toBeLessThan(CHURN_MS * 0.05);
    });
  }

  test('costs nothing while switched off', async ({ context, settings }) => {
    await settings.set({ enabled: false });
    const url = await serveMergeRequest(context, { paths: LARGE_MERGE_REQUEST, lines: 2000 });
    const page = await context.newPage();
    await page.goto(url);

    const extensionMs = await profileExtension(page, () => churnFor(page, CHURN_MS));

    expect(extensionMs).toBeLessThan(5);
  });
});

/**
 * Counts the MutationRecords the content script's observer receives, through a breakpoint whose condition counts and never pauses.
 */
async function observerRecordCounter(page) {
  const cdp = await page.context().newCDPSession(page);
  const contentScripts = [];
  const extensionWorlds = [];
  cdp.on('Debugger.scriptParsed', (event) => event.url.endsWith('/content.js') && contentScripts.push(event.scriptId));
  cdp.on('Runtime.executionContextCreated', (event) => event.context.origin.startsWith('chrome-extension://') && extensionWorlds.push(event.context.id));
  await cdp.send('Runtime.enable');
  await cdp.send('Debugger.enable');

  return {
    async start() {
      const scriptId = contentScripts.at(-1);
      const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId });
      const lineNumber = scriptSource.split('\n').findIndex((line) => line.startsWith('function scheduleScan')) + 1;
      await cdp.send('Debugger.setBreakpoint', {
        location: { scriptId, lineNumber },
        condition: 'globalThis.observedRecords = (globalThis.observedRecords ?? 0) + (arguments[0]?.length ?? 0), false',
      });
    },
    async count() {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'globalThis.observedRecords ?? 0', contextId: extensionWorlds.at(-1) });
      return result.value;
    },
  };
}

test.describe('performance while Rapid Diffs streams files in', () => {
  test('receives few DOM change records while files stream in', async ({ context }) => {
    const paths = [...Array.from({ length: 500 }, (_, i) => `src/C${i}.cs`), 'web/pnpm-lock.yaml'];
    const url = await serveMergeRequest(context, { paths, rendered: paths.slice(0, 1) });
    const page = await context.newPage();
    const records = await observerRecordCounter(page);
    await page.goto(url);
    await page.waitForTimeout(1000);
    await records.start();

    const nodes = await streamDiffFiles(page, diffFilesHtml(paths.slice(1, -1)));
    await page.waitForTimeout(500);
    const received = await records.count();

    test.info().annotations.push({ type: 'observer records', description: `${received} records for ${nodes} nodes` });
    expect(received).toBeLessThan(nodes / 2);
  });
});

test.describe('network', () => {
  test('requests the file list once on the diffs view and never elsewhere', async ({ context }) => {
    const url = await serveMergeRequest(context, { paths: LARGE_MERGE_REQUEST.slice(0, 4) });
    const fileListRequests = [];
    context.on('request', (request) => request.url().includes('diffs_metadata.json') && fileListRequests.push(request.url()));
    const page = await context.newPage();

    await page.goto(url.replace(/\/diffs$/, ''));
    await page.waitForTimeout(1000);
    expect(fileListRequests).toEqual([]);

    await page.goto(url);
    await expect.poll(async () => (await viewedPaths(page)).length).toBe(3);
    expect(fileListRequests).toHaveLength(1);
  });
});
