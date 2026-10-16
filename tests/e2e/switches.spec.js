import { expect, test } from './support/fixtures.js';
import { renderDiffFile, serveMergeRequest, viewedPaths } from './support/gitlab.js';

const LOCK = 'src/A/packages.A.lock.json';
const LATER_LOCK = 'web/pnpm-lock.yaml';
const CODE = 'src/A/Program.cs';
const QUIET_MS = 1000;

const mainSwitch = (popup) => popup.locator('#enabled');
const hostSwitch = (popup, host) => popup.locator('#hosts li', { hasText: host }).locator('input');

async function flip(toggle, checked) {
  await toggle.setChecked(checked, { force: true });
}

async function openMergeRequest(context, options) {
  const url = await serveMergeRequest(context, { paths: [LOCK, LATER_LOCK, CODE], ...options });
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test.describe('switches', () => {
  test('host switches do nothing while the extension is off', async ({ context, openPopup, settings }) => {
    await settings.set({ enabled: false });
    const page = await openMergeRequest(context);
    const popup = await openPopup();

    await flip(hostSwitch(popup, 'gitlab.com'), false);
    await flip(hostSwitch(popup, 'gitlab.com'), true);
    await page.waitForTimeout(QUIET_MS);

    expect(await viewedPaths(page)).toEqual([]);
  });

  test('switching the extension on reruns every open merge request', async ({ context, openPopup, settings }) => {
    await settings.set({ enabled: false });
    const first = await openMergeRequest(context, { id: 1 });
    const second = await openMergeRequest(context, { id: 2 });
    const popup = await openPopup();

    await flip(mainSwitch(popup), true);

    await expect.poll(() => viewedPaths(first)).toEqual([LOCK, LATER_LOCK]);
    await expect.poll(() => viewedPaths(second)).toEqual([LOCK, LATER_LOCK]);
  });

  test('switching the extension on skips a host that is switched off, until the host is switched on', async ({ context, openPopup, settings }) => {
    await settings.set({ enabled: false, disabledSites: ['https://gitlab.com'] });
    const page = await openMergeRequest(context);
    const popup = await openPopup();

    await flip(mainSwitch(popup), true);
    await page.waitForTimeout(QUIET_MS);
    expect(await viewedPaths(page)).toEqual([]);

    await flip(hostSwitch(popup, 'gitlab.com'), true);
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK]);
  });

  test('switching a host off and on again reruns it', async ({ context, openPopup }) => {
    const page = await openMergeRequest(context, { rendered: [LOCK, CODE] });
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK]);
    const popup = await openPopup();

    await flip(hostSwitch(popup, 'gitlab.com'), false);
    await renderDiffFile(page, LATER_LOCK);
    await page.waitForTimeout(QUIET_MS);
    expect(await viewedPaths(page)).toEqual([LOCK]);

    await flip(hostSwitch(popup, 'gitlab.com'), true);
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK]);
  });

  test('resumes after an in-page navigation once it had finished', async ({ context }) => {
    const page = await openMergeRequest(context, { paths: [LOCK], rendered: [LOCK] });
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK]);
    await context.route('**/merge_requests/1/diffs_metadata.json*', (route) =>
      route.fulfill({ json: { diff_files: [LOCK, LATER_LOCK].map((path) => ({ old_path: path, new_path: path })) } }),
    );
    await renderDiffFile(page, LATER_LOCK);
    await page.waitForTimeout(QUIET_MS);
    expect(await viewedPaths(page)).toEqual([LOCK]);

    await page.evaluate(() => history.pushState({}, '', `${location.pathname}?w=1`));

    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK]);
  });

  test('ticks again a file the reviewer unticked once the extension is switched off and on', async ({ context, openPopup }) => {
    const page = await openMergeRequest(context);
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK]);
    await page.locator('diff-file', { hasText: LOCK }).locator('input').uncheck();
    expect(await viewedPaths(page)).toEqual([LATER_LOCK]);
    const popup = await openPopup();

    await flip(mainSwitch(popup), false);
    await flip(mainSwitch(popup), true);

    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK]);
  });

  test('saving patterns reruns open merge requests', async ({ context, openPopup }) => {
    const page = await openMergeRequest(context);
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK]);
    const popup = await openPopup();

    await popup.locator('#patterns').fill('*.cs');
    await popup.getByRole('button', { name: 'save' }).click();

    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK, CODE]);
  });

  test('never un-views a file, whatever the switches and patterns do', async ({ context, openPopup }) => {
    const page = await openMergeRequest(context, { viewed: [CODE, LATER_LOCK] });
    await expect.poll(() => viewedPaths(page)).toEqual([LOCK, LATER_LOCK, CODE]);
    const popup = await openPopup();

    await flip(mainSwitch(popup), false);
    await flip(mainSwitch(popup), true);
    await flip(hostSwitch(popup, 'gitlab.com'), false);
    await flip(hostSwitch(popup, 'gitlab.com'), true);
    await popup.locator('#patterns').fill('*.ts');
    await popup.getByRole('button', { name: 'save' }).click();
    await expect(popup.locator('#status')).toHaveText('saved');
    await page.waitForTimeout(QUIET_MS);

    expect(await viewedPaths(page)).toEqual([LOCK, LATER_LOCK, CODE]);
  });
});
