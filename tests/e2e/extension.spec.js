import { expect, test } from './support/fixtures.js';
import { serveMergeRequest, viewedStates } from './support/gitlab.js';

const PATHS = ['src/A/packages.A.lock.json', 'src/A/Program.cs', 'web/pnpm-lock.yaml', 'web/src/app.ts'];

test.describe('on a gitlab.com merge request', () => {
  for (const view of ['rapid', 'classic']) {
    test(`ticks the lock files and leaves the code in the ${view} view`, async ({ context }) => {
      const url = await serveMergeRequest(context, { paths: PATHS, view });
      const page = await context.newPage();

      await page.goto(url);

      await expect.poll(() => viewedStates(page)).toEqual({
        'src/A/packages.A.lock.json': true,
        'src/A/Program.cs': false,
        'web/pnpm-lock.yaml': true,
        'web/src/app.ts': false,
      });
    });
  }
});

test.describe('popup', () => {
  test('fits the toolbar popup without scrolling', async ({ openPopup }) => {
    const popup = await openPopup();

    const size = await popup.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth }));

    expect(size.height).toBeLessThanOrEqual(600);
    expect(size.width).toBeLessThanOrEqual(460);
  });

  test('shows the off badge while switched off', async ({ openPopup, serviceWorker }) => {
    const popup = await openPopup();

    await popup.locator('#enabled').setChecked(false, { force: true });
    await expect.poll(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('off');

    await popup.locator('#enabled').setChecked(true, { force: true });
    await expect.poll(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  });
});

for (const colorScheme of ['light', 'dark']) {
  test.describe(`toolbar icon in ${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test('reads the colour scheme once and closes the hidden page', async ({ serviceWorker }) => {
      await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get('iconScheme')).iconScheme)).toBe(colorScheme);
      await expect
        .poll(() => serviceWorker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length))
        .toBe(0);
    });
  });
}
