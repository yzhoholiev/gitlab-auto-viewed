import { join } from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';

const EXTENSION = join(import.meta.dirname, '../../../src');
const BLINK_COLOR_SCHEME = { dark: 0, light: 1 };

/**
 * Chromium with the unpacked extension loaded into a fresh profile for every test.
 */
export const test = base.extend({
  colorScheme: ['light', { option: true }],

  context: async ({ colorScheme }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        `--blink-settings=preferredColorScheme=${BLINK_COLOR_SCHEME[colorScheme]}`,
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  openPopup: async ({ context, extensionId }, use) => {
    await use(async () => {
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 460, height: 600 });
      await popup.goto(`chrome-extension://${extensionId}/options.html`);
      return popup;
    });
  },

  settings: async ({ serviceWorker }, use) => {
    await use({
      set: (items) => serviceWorker.evaluate((values) => chrome.storage.sync.set(values), items),
      get: () => serviceWorker.evaluate(() => chrome.storage.sync.get(null)),
    });
  },
});

export { expect };
