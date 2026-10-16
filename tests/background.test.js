import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from './support/fake-chrome.js';
import { loadScripts } from './support/load-scripts.js';

const ACME = 'https://gitlab.acme.io/*';
const LOCAL = 'http://gitlab.local/*';
const SCRIPT_ID = 'self-hosted-gitlab';

function runBackground(chrome) {
  loadScripts(['hosts.js', 'patterns.js', 'background.js'], { globals: { chrome, importScripts: () => {} } });
  return chrome;
}

function loadBackground(options) {
  return runBackground(fakeChrome(options));
}

function lastBadge(chrome) {
  return chrome.action.setBadgeText.mock.lastCall?.[0].text;
}

function icons(scheme) {
  return { path: { 16: `icons/${scheme}/icon16.png`, 32: `icons/${scheme}/icon32.png` } };
}

describe('background', () => {
  describe('off badge', () => {
    it.each([
      [true, ''],
      [false, 'off'],
    ])('shows the right badge at start-up when switched on is %s', async (enabled, badge) => {
      const chrome = loadBackground({ storage: { enabled } });

      await vi.waitFor(() => expect(lastBadge(chrome)).toBe(badge));
    });
    it('shows the switch from the change itself, without reading storage again', async () => {
      const chrome = loadBackground();
      await vi.waitFor(() => expect(lastBadge(chrome)).toBe(''));

      await chrome.storage.sync.set({ enabled: false });

      expect(lastBadge(chrome)).toBe('off');
      expect(chrome.storage.sync.get).toHaveBeenCalledOnce();
    });

    it.each([
      ['patterns and site switches', (chrome) => chrome.storage.sync.set({ patterns: '*.snap', disabledSites: ['https://gitlab.acme.io'] })],
      ['the toolbar icon theme', (chrome) => chrome.storage.local.set({ iconScheme: 'light' })],
    ])('leaves the badge alone when %s change', async (change, apply) => {
      const chrome = loadBackground();
      await vi.waitFor(() => expect(chrome.action.setBadgeText).toHaveBeenCalledOnce());

      await apply(chrome);

      expect(chrome.action.setBadgeText).toHaveBeenCalledOnce();
    });
  });

  describe('toolbar icon', () => {
    it('restores the last colour scheme icon when the worker starts', async () => {
      const chrome = loadBackground({ localStorage: { iconScheme: 'light' } });

      await vi.waitFor(() => expect(chrome.action.setIcon).toHaveBeenCalledWith(icons('light')));
    });

    it('keeps the manifest icon when no colour scheme is known yet', async () => {
      const chrome = loadBackground();
      await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());

      expect(chrome.action.setIcon).not.toHaveBeenCalled();
    });

    it.each([['install', 'onInstalled'], ['browser start', 'onStartup']])('reads the colour scheme on %s', async (when, event) => {
      const chrome = loadBackground();

      await chrome.runtime[event].dispatch({ reason: 'install' });

      await vi.waitFor(() =>
        expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({ url: 'probe.html', reasons: ['MATCH_MEDIA'] })),
      );
    });

    it('does not open a hidden page on other wake-ups', async () => {
      const chrome = loadBackground();

      await chrome.storage.sync.set({ enabled: false });
      await chrome.runtime.onMessage.dispatch({ type: 'color-scheme', scheme: 'dark' });

      expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    });

    it('opens one hidden page when install and browser start fire together', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const chrome = loadBackground();

      await Promise.all([chrome.runtime.onInstalled.dispatch({ reason: 'update' }), chrome.runtime.onStartup.dispatch()]);

      await vi.waitFor(() => expect(chrome.offscreen.createDocument).toHaveBeenCalled());
      expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
      expect(error).not.toHaveBeenCalled();
    });

    it('does not open a second hidden page', async () => {
      const chrome = fakeChrome();
      chrome.runtime.getContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
      runBackground(chrome);

      await chrome.runtime.onStartup.dispatch();

      expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    });

    it('logs a hidden page that fails to open', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const chrome = fakeChrome();
      chrome.offscreen.createDocument.mockRejectedValueOnce(new Error('offscreen unavailable'));
      runBackground(chrome);

      await chrome.runtime.onStartup.dispatch();

      expect(error).toHaveBeenCalledWith('Reading the browser colour scheme failed', expect.any(Error));
    });

    it.each(['dark', 'light'])('shows the %s icons and remembers the scheme', async (scheme) => {
      const chrome = loadBackground();

      await chrome.runtime.onMessage.dispatch({ type: 'color-scheme', scheme });

      await vi.waitFor(() => expect(chrome.storage.local.data().iconScheme).toBe(scheme));
      expect(chrome.action.setIcon).toHaveBeenCalledWith(icons(scheme));
    });

    it('leaves the icon alone when it already shows the reported scheme', async () => {
      const chrome = loadBackground({ localStorage: { iconScheme: 'dark' } });
      await vi.waitFor(() => expect(chrome.action.setIcon).toHaveBeenCalledOnce());

      await chrome.runtime.onMessage.dispatch({ type: 'color-scheme', scheme: 'dark' });
      await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(2));

      expect(chrome.action.setIcon).toHaveBeenCalledOnce();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('waits for the hidden page to finish opening before closing it', async () => {
      const chrome = fakeChrome();
      let finishOpening;
      chrome.offscreen.createDocument.mockImplementationOnce(() => new Promise((resolve) => (finishOpening = resolve)));
      runBackground(chrome);
      chrome.runtime.onStartup.dispatch();
      await vi.waitFor(() => expect(chrome.offscreen.createDocument).toHaveBeenCalled());
      chrome.runtime.getContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

      chrome.runtime.onMessage.dispatch({ type: 'color-scheme-probe', scheme: 'dark' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();

      finishOpening();
      await vi.waitFor(() => expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce());
    });

    it('lets a theme report that arrives during start-up win over the slower restored icon', async () => {
      const chrome = fakeChrome({ localStorage: { iconScheme: 'dark' } });
      let shownIcon;
      chrome.action.setIcon
        .mockImplementationOnce(({ path }) => new Promise((resolve) => setTimeout(() => resolve((shownIcon = path[16])), 20)))
        .mockImplementation(async ({ path }) => {
          shownIcon = path[16];
        });
      runBackground(chrome);

      await chrome.runtime.onMessage.dispatch({ type: 'color-scheme', scheme: 'light' });

      await vi.waitFor(() => expect(chrome.storage.local.data().iconScheme).toBe('light'));
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(shownIcon).toBe('icons/light/icon16.png');
    });

    it('applies quick successive theme reports in order', async () => {
      const chrome = loadBackground({ localStorage: { iconScheme: 'dark' } });

      await Promise.all([
        chrome.runtime.onMessage.dispatch({ type: 'color-scheme', scheme: 'light' }),
        chrome.runtime.onMessage.dispatch({ type: 'color-scheme', scheme: 'dark' }),
      ]);

      await vi.waitFor(() => expect(chrome.action.setIcon).toHaveBeenLastCalledWith(icons('dark')));
      expect(chrome.storage.local.data().iconScheme).toBe('dark');
    });

  });

  describe('self-hosted content scripts', () => {
    it('registers the content scripts for a newly granted host', async () => {
      const chrome = loadBackground();

      await chrome.permissions.request({ origins: [ACME] });

      await vi.waitFor(() =>
        expect(chrome.scripting.registered.get(SCRIPT_ID)).toEqual({
          id: SCRIPT_ID,
          matches: ['https://gitlab.acme.io/*/-/merge_requests/*'],
          js: ['patterns.js', 'theme.js', 'content.js'],
          runAt: 'document_idle',
        }),
      );
    });

    it('registers hosts granted before install', async () => {
      const chrome = loadBackground({ origins: ['https://gitlab.com/*/-/merge_requests/*', ACME] });

      await chrome.runtime.onInstalled.dispatch({ reason: 'install' });

      await vi.waitFor(() => expect(chrome.scripting.registered.get(SCRIPT_ID)?.matches).toEqual(['https://gitlab.acme.io/*/-/merge_requests/*']));
    });

    it('updates the registered scripts in place when another host is granted', async () => {
      const chrome = loadBackground();
      await chrome.permissions.request({ origins: [ACME] });
      await vi.waitFor(() => expect(chrome.scripting.registered.has(SCRIPT_ID)).toBe(true));

      await chrome.permissions.request({ origins: [LOCAL] });

      await vi.waitFor(() =>
        expect(chrome.scripting.registered.get(SCRIPT_ID).matches).toEqual([
          'https://gitlab.acme.io/*/-/merge_requests/*',
          'http://gitlab.local/*/-/merge_requests/*',
        ]),
      );
      expect(chrome.scripting.registerContentScripts).toHaveBeenCalledOnce();
      expect(chrome.scripting.unregisterContentScripts).not.toHaveBeenCalled();
    });

    it('unregisters the scripts when the last host is removed', async () => {
      const chrome = loadBackground();
      await chrome.permissions.request({ origins: [ACME] });
      await vi.waitFor(() => expect(chrome.scripting.registered.has(SCRIPT_ID)).toBe(true));

      await chrome.permissions.remove({ origins: [ACME] });

      await vi.waitFor(() => expect(chrome.scripting.registered.has(SCRIPT_ID)).toBe(false));
    });

    it('handles host changes in quick succession without a duplicate registration', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const chrome = loadBackground();

      await Promise.all([chrome.permissions.request({ origins: [ACME] }), chrome.permissions.request({ origins: [LOCAL] })]);

      await vi.waitFor(() => expect(chrome.scripting.registered.get(SCRIPT_ID)?.matches).toHaveLength(2));
      expect(error).not.toHaveBeenCalled();
    });

    it('logs a failed registration', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const chrome = loadBackground();
      chrome.scripting.registerContentScripts.mockRejectedValueOnce(new Error('bad match pattern'));

      await chrome.permissions.request({ origins: [ACME] });

      await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Registering self-hosted content scripts failed', expect.any(Error)));
    });

    it('ignores a wildcard grant such as "on all sites"', async () => {
      const chrome = loadBackground();

      await chrome.permissions.request({ origins: ['https://*/*'] });

      await vi.waitFor(() => expect(chrome.permissions.getAll).toHaveBeenCalled());
      expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
    });

  });
});
