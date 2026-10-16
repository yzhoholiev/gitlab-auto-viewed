import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from './support/fake-chrome.js';
import { loadScripts } from './support/load-scripts.js';

function fakeColorScheme(dark) {
  const listeners = [];
  return {
    matches: dark,
    listeners,
    addEventListener: (type, listener) => listeners.push(listener),
    removeEventListener: (type, listener) => listeners.splice(listeners.indexOf(listener), 1),
    switchTo(nextDark) {
      this.matches = nextDark;
      [...listeners].forEach((listener) => listener());
    },
  };
}

function loadTheme(dark, chrome) {
  const scheme = fakeColorScheme(dark);
  const matchMedia = vi.fn(() => scheme);
  vi.stubGlobal('matchMedia', matchMedia);
  loadScripts(['theme.js'], { globals: { chrome } });
  return { scheme, matchMedia };
}

function afterFirstPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 10)));
}

function offscreenChrome() {
  return { runtime: { id: 'test-extension', sendMessage: vi.fn(async () => {}) } };
}

describe('theme reporting', () => {
  describe('on a visible page', () => {
    it('reports the colour scheme after the first paint when the icon does not match it', async () => {
      const chrome = fakeChrome({ localStorage: { iconScheme: 'dark' } });

      const { matchMedia } = loadTheme(false, chrome);
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
      await afterFirstPaint();

      expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'color-scheme', scheme: 'light' });
    });

    it('stays quiet when the icon already matches', async () => {
      const chrome = fakeChrome({ localStorage: { iconScheme: 'dark' } });

      loadTheme(true, chrome);
      await afterFirstPaint();

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('swallows a background that cannot be reached', async () => {
      const chrome = fakeChrome({ localStorage: { iconScheme: 'dark' } });
      chrome.runtime.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);

      loadTheme(false, chrome);
      await afterFirstPaint();
      process.off('unhandledRejection', unhandled);

      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('stops listening once the extension is reloaded', () => {
      const chrome = fakeChrome({ localStorage: { iconScheme: 'dark' } });
      const { scheme } = loadTheme(true, chrome);
      chrome.runtime.id = undefined;

      expect(() => scheme.switchTo(false)).not.toThrow();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(scheme.listeners).toHaveLength(0);
    });

    it('reports a change of colour scheme', () => {
      const chrome = fakeChrome({ localStorage: { iconScheme: 'dark' } });
      const { scheme } = loadTheme(true, chrome);

      scheme.switchTo(false);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'color-scheme', scheme: 'light' });
    });
  });

  describe('in the hidden probe page', () => {
    it.each([
      [true, 'dark'],
      [false, 'light'],
    ])('reports the %s scheme as a probe result', (dark, scheme) => {
      vi.stubGlobal('matchMedia', vi.fn(() => fakeColorScheme(dark)));
      const chrome = offscreenChrome();

      loadScripts(['probe.js'], { globals: { chrome } });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'color-scheme-probe', scheme });
    });
  });
});
