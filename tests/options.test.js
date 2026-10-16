import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from './support/fake-chrome.js';
import { loadScripts, readSource } from './support/load-scripts.js';

const POPUP_BODY = readSource('options.html')
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script[\s\S]*?<\/script>/g, '');

const ACME = 'https://gitlab.acme.io/*';

async function openPopup(options) {
  document.body.innerHTML = POPUP_BODY;
  const chrome = fakeChrome(options);
  loadScripts(['hosts.js', 'patterns.js', 'options.js'], { globals: { chrome } });
  await vi.waitFor(() => expect(hostRows()).not.toHaveLength(0));
  return chrome;
}

const element = (id) => document.getElementById(id);
const hostRows = () => [...element('hosts').children];
const hostRow = (name) => hostRows().find((row) => row.querySelector('.host-name').textContent === name);
const button = (text) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === text);

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function toggle(checkbox, checked) {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event('change'));
}

function submitHost(value) {
  element('hostInput').value = value;
  element('addHost').dispatchEvent(new Event('submit', { cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('popup', () => {
  describe('settings', () => {
    it('shows the stored settings', async () => {
      await openPopup({ storage: { patterns: '# mine\n*.lock.json\nyarn.lock' }, version: '1.2.3' });

      expect(element('patterns').value).toBe('# mine\n*.lock.json\nyarn.lock');
      expect(element('count').textContent).toBe('2 active');
      expect(element('enabled').checked).toBe(true);
      expect(element('enabledLabel').textContent).toBe('on');
      expect(element('version').textContent).toBe('v1.2.3');
    });

    it('follows the switch when it changes elsewhere', async () => {
      const chrome = await openPopup();

      await chrome.storage.sync.set({ enabled: false });

      expect(element('enabled').checked).toBe(false);
      expect(element('enabledLabel').textContent).toBe('off');
    });

    it('saves only the patterns, leaving a switch changed elsewhere alone', async () => {
      const chrome = await openPopup();
      await chrome.storage.sync.set({ enabled: false });
      type(element('patterns'), '*.snap');

      button('save').click();

      await vi.waitFor(() => expect(element('status').textContent).toBe('saved'));
      expect(chrome.storage.data()).toMatchObject({ enabled: false, patterns: '*.snap' });
    });

    it('refuses to save invalid patterns and says why', async () => {
      const chrome = await openPopup();
      type(element('patterns'), '*.lock.json\n*.[ch]');

      button('save').click();

      expect(element('errors').textContent).toContain('*.[ch]: [...] character classes are not supported');
      expect(element('status').textContent).toBe('fix the errors above first');
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('reports a save the browser rejected', async () => {
      const chrome = await openPopup();
      chrome.storage.sync.failWith = 'QUOTA_BYTES_PER_ITEM quota exceeded';

      button('save').click();

      await vi.waitFor(() => expect(element('status').textContent).toBe('not saved: QUOTA_BYTES_PER_ITEM quota exceeded'));
      expect(element('status').dataset.state).toBe('error');
    });

    it('reset refills the editor without saving', async () => {
      const chrome = await openPopup({ storage: { patterns: '*.snap' } });

      button('reset').click();

      expect(element('patterns').value).toContain('*.lock.json');
      expect(element('status').textContent).toBe('defaults loaded, save to apply');
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('tells whether a sample path matches', async () => {
      await openPopup();

      type(element('sample'), 'src/A/packages.A.lock.json');
      expect(element('sampleResult').dataset.state).toBe('match');

      type(element('patterns'), '/package-lock.json');
      type(element('sample'), '/package-lock.json');
      expect(element('sampleResult').dataset.state).toBe('match');

      type(element('sample'), 'src/A/Program.cs');
      expect(element('sampleResult').dataset.state).toBe('none');
      expect(element('sampleResult').textContent).toBe('no match');
    });
  });

  describe('hosts', () => {
    it('lists gitlab.com and every self-hosted host', async () => {
      await openPopup({ origins: ['https://gitlab.com/*/-/merge_requests/*', ACME, 'http://gitlab.local/*'] });

      expect(hostRows().map((row) => row.querySelector('.host-name').textContent)).toEqual([
        'gitlab.com',
        'gitlab.acme.io',
        'http://gitlab.local',
      ]);
      expect(hostRow('gitlab.com').querySelector('.tag').textContent).toBe('built-in');
      expect(hostRow('gitlab.acme.io').querySelector('button.link').textContent).toBe('remove');
    });

    it('shows a switched-off host as off', async () => {
      await openPopup({ storage: { disabledSites: ['https://gitlab.com'] } });

      expect(hostRow('gitlab.com').classList.contains('disabled')).toBe(true);
      expect(hostRow('gitlab.com').querySelector('input').checked).toBe(false);
    });

    it('switches a host off and on, confirming each save', async () => {
      const chrome = await openPopup({ origins: [ACME] });

      toggle(hostRow('gitlab.acme.io').querySelector('input'), false);
      await vi.waitFor(() => expect(chrome.storage.data().disabledSites).toEqual(['https://gitlab.acme.io']));
      await vi.waitFor(() => expect(hostRow('gitlab.acme.io').classList.contains('disabled')).toBe(true));
      expect(element('hostStatus').textContent).toBe('saved');
      expect(element('hostStatus').dataset.state).toBe('saved');

      toggle(hostRow('gitlab.acme.io').querySelector('input'), true);
      await vi.waitFor(() => expect(chrome.storage.data().disabledSites).toEqual([]));
    });
    it.each([[[]], [['https://gitlab.acme.io']]])('says when the browser kept the site access and leaves the switch as it was (%j off)', async (disabledSites) => {
      const chrome = await openPopup({ origins: [ACME], storage: { disabledSites } });
      chrome.permissions.removeNext = false;

      hostRow('gitlab.acme.io').querySelector('button.link').click();

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('could not remove site access for gitlab.acme.io'));
      expect(element('hostStatus').dataset.state).toBe('error');
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
      expect(chrome.storage.data().disabledSites).toEqual(disabledSites);
    });

    it('says when removing the site access fails outright', async () => {
      const chrome = await openPopup({ origins: [ACME] });
      chrome.permissions.remove.mockRejectedValueOnce(new Error('Invalid match pattern'));

      hostRow('gitlab.acme.io').querySelector('button.link').click();

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('could not remove site access for gitlab.acme.io'));
    });

    it('reports a failed save when clearing the switch of a removed host', async () => {
      const chrome = await openPopup({ origins: [ACME], storage: { disabledSites: ['https://gitlab.acme.io'] } });
      chrome.storage.sync.failWith = 'MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded';

      hostRow('gitlab.acme.io').querySelector('button.link').click();

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('not saved: MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
    });

    it('keeps http and https on the same host apart', async () => {
      const chrome = await openPopup({ origins: ['http://gitlab.local/*', 'https://gitlab.local/*'] });

      toggle(hostRow('http://gitlab.local').querySelector('input'), false);

      await vi.waitFor(() => expect(chrome.storage.data().disabledSites).toEqual(['http://gitlab.local']));
      await vi.waitFor(() => expect(hostRow('http://gitlab.local').classList.contains('disabled')).toBe(true));
      expect(hostRow('gitlab.local').classList.contains('disabled')).toBe(false);
    });

    it('keeps a host list redrawn while the popup was still opening', async () => {
      document.body.innerHTML = POPUP_BODY;
      const chrome = fakeChrome({ origins: [ACME] });
      chrome.permissions.getAll.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ origins: [] }), 30)));
      loadScripts(['hosts.js', 'patterns.js', 'options.js'], { globals: { chrome } });

      await chrome.storage.sync.set({ disabledSites: ['https://gitlab.acme.io'] });
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(hostRow('gitlab.acme.io').classList.contains('disabled')).toBe(true);
    });

    it('shows the newest host list when redraws overlap', async () => {
      const chrome = await openPopup();
      chrome.permissions.getAll
        .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ origins: [] }), 30)))
        .mockImplementationOnce(async () => ({ origins: [ACME] }));

      chrome.permissions.onAdded.dispatch({ origins: [ACME] });
      chrome.permissions.onAdded.dispatch({ origins: [ACME] });
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(hostRow('gitlab.acme.io')).toBeDefined();
    });

    it('redraws the hosts when the settings change elsewhere', async () => {
      const chrome = await openPopup();

      await chrome.storage.sync.set({ disabledSites: ['https://gitlab.com'] });

      await vi.waitFor(() => expect(hostRow('gitlab.com').classList.contains('disabled')).toBe(true));
    });

    it('switches on a host that is added again while switched off', async () => {
      const chrome = await openPopup({ origins: [ACME], storage: { disabledSites: ['https://gitlab.acme.io'] } });

      submitHost('gitlab.acme.io');

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('added, reload open merge requests on gitlab.acme.io'));
      expect(chrome.storage.data().disabledSites).toEqual([]);
    });

    it('keeps keyboard focus on a host switch after it redraws the list', async () => {
      const chrome = await openPopup({ origins: [ACME] });
      const input = hostRow('gitlab.acme.io').querySelector('input');
      input.focus();

      toggle(input, false);

      await vi.waitFor(() => expect(chrome.storage.data().disabledSites).toEqual(['https://gitlab.acme.io']));
      await vi.waitFor(() => expect(hostRow('gitlab.acme.io').classList.contains('disabled')).toBe(true));
      expect(document.activeElement).toBe(hostRow('gitlab.acme.io').querySelector('input'));
      expect(document.activeElement).not.toBe(input);
    });

    it('asks the browser for access to an added host', async () => {
      const chrome = await openPopup();

      submitHost('https://gitlab.acme.io/group/project/-/merge_requests/3');

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('added, reload open merge requests on gitlab.acme.io'));
      expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: [ACME] });
      expect(element('hostInput').value).toBe('');
    });
    it('keeps the error when switching on an added host fails to save', async () => {
      const chrome = await openPopup();
      chrome.storage.sync.failWith = 'MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded';

      submitHost('gitlab.acme.io');

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('not saved: MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
      expect(element('hostInput').value).toBe('gitlab.acme.io');
    });

    it('explains when the browser already allows every site, so the host cannot be listed', async () => {
      const chrome = await openPopup();
      chrome.permissions.request.mockImplementationOnce(async () => true);

      submitHost('gitlab.acme.io');

      await vi.waitFor(() => expect(element('hostStatus').textContent).toContain('set its site access to "On specific sites"'));
      expect(element('hostStatus').dataset.state).toBe('error');
    });

    it('confirms the main switch next to it, not next to the pattern buttons', async () => {
      await openPopup();

      toggle(element('enabled'), false);

      await vi.waitFor(() => expect(element('enabledStatus').textContent).toBe('saved'));
      expect(element('status').textContent).toBe('');
    });

    it('says access was not granted when the request itself fails', async () => {
      const chrome = await openPopup();
      chrome.permissions.request.mockRejectedValueOnce(new Error('This function must be called during a user gesture'));

      submitHost('gitlab.acme.io');

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('access not granted'));
    });
    it('clears the switch of a host it removes', async () => {
      const chrome = await openPopup({ origins: [ACME], storage: { disabledSites: ['https://gitlab.acme.io', 'https://other.host'] } });

      hostRow('gitlab.acme.io').querySelector('button.link').click();

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('removed gitlab.acme.io and its site access'));
      expect(hostRow('gitlab.acme.io')).toBeUndefined();
      expect(chrome.permissions.granted.has(ACME)).toBe(false);
      expect(chrome.storage.data().disabledSites).toEqual(['https://other.host']);
    });

    it('says when the browser refused access', async () => {
      const chrome = await openPopup();
      chrome.permissions.grantNext = false;

      submitHost('gitlab.acme.io');

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe('access not granted'));
      expect(element('hostStatus').dataset.state).toBe('error');
    });

    it.each([
      ['has space', 'not a valid host'],
      ['gitlab.com', 'gitlab.com is built in'],
    ])('does not ask for %j', async (input, message) => {
      const chrome = await openPopup();

      submitHost(input);

      await vi.waitFor(() => expect(element('hostStatus').textContent).toBe(message));
      expect(chrome.permissions.request).not.toHaveBeenCalled();
    });

    it('suggests the self-hosted GitLab in the current tab', async () => {
      await openPopup({ activeTabUrl: 'https://git.corp.example/group/project/-/merge_requests/5/diffs' });

      await vi.waitFor(() => expect(element('hostInput').value).toBe('https://git.corp.example'));
      expect(element('hostStatus').textContent).toBe('this site looks like GitLab, press add to enable it');
    });

    it.each([
      ['gitlab.com', 'https://gitlab.com/group/project/-/merge_requests/5'],
      ['a site that is not GitLab', 'https://example.com/docs'],
      ['a host that is already added', 'https://gitlab.acme.io/group/project/-/merge_requests/5'],
      ['a browser page', 'edge://extensions'],
    ])('does not suggest %s', async (description, activeTabUrl) => {
      await openPopup({ origins: [ACME], activeTabUrl });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(element('hostInput').value).toBe('');
      expect(element('hostStatus').textContent).toBe('');
    });
  });
});
