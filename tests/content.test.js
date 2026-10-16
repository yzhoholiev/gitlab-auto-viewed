import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from './support/fake-chrome.js';
import { loadScripts } from './support/load-scripts.js';

const MERGE_REQUEST_URL = 'https://gitlab.com/group/project/-/merge_requests/7/diffs';
const TEN_MINUTES = 10 * 60 * 1000;

function metadataResponse(paths) {
  if (paths === null) return { ok: false };
  return { ok: true, json: async () => ({ diff_files: paths.map((path) => ({ old_path: path, new_path: path })) }) };
}

const loadedScripts = [];

function loadContentScript({ storage, metadata = [], url = MERGE_REQUEST_URL } = {}) {
  window.happyDOM.setURL(url);
  const fetch = vi.fn(async (requested) => metadataResponse(typeof metadata === 'function' ? metadata(requested) : metadata));
  vi.stubGlobal('fetch', fetch);
  const chrome = fakeChrome({ storage });
  loadedScripts.push(loadScripts(['patterns.js', 'content.js'], { globals: { chrome }, expose: ['stopWatching', 'resumeAfterIdle'] }));
  return { chrome, fetch };
}

function rapidDiff(path, { checked = false, withCheckbox = true } = {}) {
  const file = document.createElement('diff-file');
  file.dataset.fileData = JSON.stringify({ old_path: path, new_path: path });
  document.body.append(file);
  if (withCheckbox) addRapidCheckbox(file, checked);
  return file;
}

function addRapidCheckbox(file, checked = false) {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.viewedCheckbox = '';
  checkbox.checked = checked;
  file.append(checkbox);
  return checkbox;
}

function classicDiff(path) {
  const file = document.createElement('div');
  file.className = 'diff-file';
  file.dataset.path = path;
  file.innerHTML = '<input type="checkbox" data-testid="fileReviewCheckbox">';
  document.body.append(file);
  return file;
}

function viewed(file) {
  return file.querySelector('input[type="checkbox"]').checked;
}

const settle = () => vi.advanceTimersByTimeAsync(300);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const { stopWatching, resumeAfterIdle } of loadedScripts.splice(0)) {
    stopWatching();
    removeEventListener('scroll', resumeAfterIdle, { capture: true });
  }
  vi.useRealTimers();
});

describe('content script', () => {
  it('skips a file whose data cannot be read and keeps ticking the rest', async () => {
    const unreadable = rapidDiff('broken.lock.json');
    unreadable.dataset.fileData = '{"new_path": "broken.lock.json"';
    const readable = rapidDiff('a.lock.json');

    loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    expect(viewed(unreadable)).toBe(false);
    expect(viewed(readable)).toBe(true);
  });

  it('reads each file once however many scans run', async () => {
    rapidDiff('a.lock.json');
    rapidDiff('b.cs');
    rapidDiff('c.cs');
    loadContentScript({ metadata: ['a.lock.json', 'b.cs', 'c.cs', 'never-rendered.lock.json'] });
    await settle();
    const parse = vi.spyOn(JSON, 'parse');

    for (let i = 0; i < 5; i++) {
      document.body.append(document.createElement('span'));
      await settle();
    }

    expect(parse).not.toHaveBeenCalled();
  });

  it('does not click files that are already viewed', async () => {
    const file = rapidDiff('yarn.lock', { checked: true });
    const clicks = vi.fn();
    file.addEventListener('click', clicks);

    loadContentScript({ metadata: ['yarn.lock'] });
    await settle();

    expect(clicks).not.toHaveBeenCalled();
    expect(viewed(file)).toBe(true);
  });

  it('ticks a file once its checkbox renders', async () => {
    const file = rapidDiff('a.lock.json', { withCheckbox: false });
    loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    addRapidCheckbox(file);
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('leaves a file unticked by the reviewer unticked when it re-renders', async () => {
    const file = rapidDiff('a.lock.json');
    loadContentScript({ metadata: ['a.lock.json', 'b.lock.json'] });
    await settle();
    file.remove();

    const reRendered = rapidDiff('a.lock.json');
    const laterFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(reRendered)).toBe(false);
    expect(viewed(laterFile)).toBe(true);
  });

  it('stops watching once every matching file in the merge request is ticked', async () => {
    rapidDiff('a.lock.json');
    loadContentScript({ metadata: ['a.lock.json', 'Program.cs'] });
    await settle();

    const unlistedFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(unlistedFile)).toBe(false);
  });

  it('keeps watching while new files keep appearing and stops after ten idle minutes', async () => {
    rapidDiff('a.lock.json');
    loadContentScript({ metadata: ['a.lock.json', 'never-rendered.lock.json'] });
    await settle();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 1000);
    const beforeLimit = rapidDiff('b.lock.json');
    await settle();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    const afterLimit = rapidDiff('c.lock.json');
    await settle();

    expect(viewed(beforeLimit)).toBe(true);
    expect(viewed(afterLimit)).toBe(false);
  });

  it.each([
    ['the main switch', { enabled: false }, { enabled: true }],
    ['the host switch', { disabledSites: ['https://gitlab.com'] }, { disabledSites: [] }],
  ])('ticks again a file the reviewer unticked when %s goes off and on again', async (name, off, on) => {
    const file = rapidDiff('a.lock.json');
    const { chrome } = loadContentScript({ metadata: ['a.lock.json'] });
    await settle();
    file.querySelector('input').checked = false;

    await chrome.storage.sync.set(off);
    await chrome.storage.sync.set(on);
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('ticks again a file the reviewer unticked when the patterns are saved', async () => {
    const file = rapidDiff('a.lock.json');
    const { chrome } = loadContentScript({ metadata: ['a.lock.json'] });
    await settle();
    file.querySelector('input').checked = false;

    await chrome.storage.sync.set({ patterns: [{ pattern: '*.lock.json', enabled: true }, { pattern: '*.snap', enabled: true }] });
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('reruns with a fresh ten-minute idle timer when switched off and on again', async () => {
    rapidDiff('a.lock.json');
    const { chrome } = loadContentScript({ metadata: ['a.lock.json', 'never-rendered.lock.json'] });
    await settle();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 60 * 1000);

    await chrome.storage.sync.set({ enabled: false });
    await chrome.storage.sync.set({ enabled: true });
    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 60 * 1000);
    const laterFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(laterFile)).toBe(true);
  });

  it('keeps ticking rendered files when the file list cannot be read', async () => {
    rapidDiff('a.lock.json');
    loadContentScript({ metadata: null });
    await settle();

    const laterFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(laterFile)).toBe(true);
  });

  it('requests the file list with the page filters', async () => {
    rapidDiff('a.lock.json');

    const { fetch } = loadContentScript({ url: `${MERGE_REQUEST_URL}?diff_id=3&w=1` });
    await settle();

    expect(fetch).toHaveBeenCalledWith('/group/project/-/merge_requests/7/diffs_metadata.json?diff_id=3&w=1');
  });

  it('ticks a classic diff element reused for another file when only its path attribute changes', async () => {
    const file = classicDiff('Program.cs');
    loadContentScript({ metadata: ['Program.cs', 'a.lock.json'] });
    await settle();

    file.dataset.path = 'a.lock.json';
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('ticks a reused classic diff element without a path attribute when its title changes', async () => {
    const file = classicDiff('Program.cs');
    delete file.dataset.path;
    file.insertAdjacentHTML('afterbegin', '<span class="file-title-name" title="Program.cs">Program.cs</span>');
    loadContentScript({ metadata: ['Program.cs', 'a.lock.json'] });
    await settle();

    file.querySelector('.file-title-name').setAttribute('title', 'a.lock.json');
    file.append(document.createElement('span'));
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('ticks only files matching a switched-on pattern', async () => {
    const lock = rapidDiff('a.lock.json');
    const snapshot = rapidDiff('Foo.snap');

    loadContentScript({
      storage: { patterns: [{ pattern: '*.lock.json', enabled: true }, { pattern: '*.snap', enabled: false }] },
      metadata: ['a.lock.json', 'Foo.snap'],
    });
    await settle();

    expect([viewed(lock), viewed(snapshot)]).toEqual([true, false]);
  });

  it('reads patterns saved as text by an earlier version', async () => {
    const file = rapidDiff('Foo.snap');

    loadContentScript({ storage: { patterns: '# mine\n*.snap' }, metadata: ['Foo.snap'] });
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('does not restart when a switched-off pattern is removed', async () => {
    rapidDiff('a.lock.json');
    const { chrome } = loadContentScript({
      storage: { patterns: [{ pattern: '*.lock.json', enabled: true }, { pattern: '*.snap', enabled: false }] },
      metadata: ['a.lock.json'],
    });
    await settle();

    await chrome.storage.sync.set({ patterns: [{ pattern: '*.lock.json', enabled: true }] });
    const unlistedFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(unlistedFile)).toBe(false);
  });

  it('stays idle without any active pattern', async () => {
    const file = rapidDiff('a.lock.json');

    const { fetch } = loadContentScript({ storage: { patterns: [{ pattern: '*.lock.json', enabled: false }] }, metadata: ['a.lock.json'] });
    await settle();

    expect(fetch).not.toHaveBeenCalled();
    expect(viewed(file)).toBe(false);
  });

  it('ticks a classic diff whose checkbox sits inside a test-id wrapper, as older GitLab renders it', async () => {
    const file = document.createElement('div');
    file.className = 'diff-file';
    file.dataset.path = 'a.lock.json';
    file.innerHTML = '<div data-testid="fileReviewCheckbox"><input type="checkbox"></div>';
    document.body.append(file);

    loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('ignores inputs outside diff files', async () => {
    const search = document.createElement('input');
    search.type = 'checkbox';
    search.dataset.viewedCheckbox = '';
    document.body.append(search);

    loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    expect(search.checked).toBe(false);
  });

  it.each([
    ['the toolbar icon theme', (chrome) => chrome.storage.local.set({ iconScheme: 'light' })],
    ['another site being switched off', (chrome) => chrome.storage.sync.set({ disabledSites: ['https://gitlab.acme.io'] })],
  ])('does not restart for a change to %s', async (change, apply) => {
    rapidDiff('a.lock.json');
    const { chrome } = loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    await apply(chrome);
    const unlistedFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(unlistedFile)).toBe(false);
  });

  it('does nothing outside a merge request page', async () => {
    const file = rapidDiff('a.lock.json');

    const { fetch } = loadContentScript({ url: 'https://gitlab.com/group/project/-/merge_requests' });
    await settle();

    expect(fetch).not.toHaveBeenCalled();
    expect(viewed(file)).toBe(false);
  });

  it('stops ticking when switched off mid-review', async () => {
    rapidDiff('a.lock.json');
    const { chrome } = loadContentScript({ metadata: ['a.lock.json', 'b.lock.json'] });
    await settle();

    await chrome.storage.sync.set({ enabled: false });
    const laterFile = rapidDiff('b.lock.json');
    await settle();

    expect(viewed(laterFile)).toBe(false);
  });

  it('treats a page on a non-default port as the same site as its host', async () => {
    const file = rapidDiff('a.lock.json');

    loadContentScript({
      url: 'https://git.corp:8443/group/project/-/merge_requests/7/diffs',
      storage: { disabledSites: ['https://git.corp'] },
      metadata: ['a.lock.json'],
    });
    await settle();

    expect(viewed(file)).toBe(false);
  });

  it('keeps http and https on the same host apart', async () => {
    const file = rapidDiff('a.lock.json');

    loadContentScript({
      url: 'http://gitlab.acme.io/group/project/-/merge_requests/7/diffs',
      storage: { disabledSites: ['https://gitlab.acme.io'] },
      metadata: ['a.lock.json'],
    });
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('stops an overview tab after ten idle minutes and resumes when the reviewer scrolls the diffs', async () => {
    loadContentScript({ url: 'https://gitlab.com/group/project/-/merge_requests/7', metadata: ['a.lock.json'] });
    await settle();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);

    const file = rapidDiff('a.lock.json');
    await settle();
    expect(viewed(file)).toBe(false);

    document.dispatchEvent(new Event('scroll'));
    await settle();
    expect(viewed(file)).toBe(true);
  });

  it('stops once the extension is reloaded or removed', async () => {
    const { chrome } = loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    chrome.runtime.id = undefined;
    const file = rapidDiff('a.lock.json');
    await settle();

    expect(viewed(file)).toBe(false);
  });
});

describe('DOM observation', () => {
  class FakeObserver {
    static instances = [];

    constructor(callback) {
      this.callback = callback;
      this.observing = false;
      FakeObserver.instances.push(this);
    }

    observe() {
      this.observing = true;
    }

    disconnect() {
      this.observing = false;
    }

    notify() {
      this.callback([]);
    }
  }

  function loadWithFakeObserver(metadata) {
    window.happyDOM.setURL(MERGE_REQUEST_URL);
    vi.stubGlobal('fetch', vi.fn(async () => metadataResponse(metadata)));
    FakeObserver.instances = [];
    const script = loadScripts(['patterns.js', 'content.js'], {
      globals: { chrome: fakeChrome(), MutationObserver: FakeObserver },
      expose: ['stopWatching', 'resumeAfterIdle'],
    });
    loadedScripts.push(script);
    return FakeObserver.instances[0];
  }

  it('stops observing from a DOM change until the scan it queued runs', async () => {
    rapidDiff('a.lock.json');
    const observer = loadWithFakeObserver(['a.lock.json', 'never-rendered.lock.json']);
    await settle();
    expect(observer.observing).toBe(true);

    observer.notify();
    expect(observer.observing).toBe(false);

    await settle();
    expect(observer.observing).toBe(true);
  });

  it('stays disconnected once every matching file is ticked', async () => {
    rapidDiff('a.lock.json');
    const observer = loadWithFakeObserver(['a.lock.json']);

    await settle();
    await settle();

    expect(observer.observing).toBe(false);
  });
});

describe('in-page navigation', () => {
  function navigateTo(url) {
    window.happyDOM.setURL(url);
    navigation.dispatchEvent(new Event('currententrychange'));
  }

  beforeEach(() => {
    vi.stubGlobal('navigation', new EventTarget());
  });

  it('resumes after finishing when a diff filter changes, with a fresh file list', async () => {
    rapidDiff('a.lock.json');
    const { fetch } = loadContentScript({
      metadata: (requested) => (requested.includes('w=1') ? ['a.lock.json', 'b.lock.json'] : ['a.lock.json']),
    });
    await settle();
    const laterFile = rapidDiff('b.lock.json');
    await settle();
    expect(viewed(laterFile)).toBe(false);

    navigateTo(`${MERGE_REQUEST_URL}?w=1`);
    await settle();

    expect(viewed(laterFile)).toBe(true);
    expect(fetch).toHaveBeenLastCalledWith('/group/project/-/merge_requests/7/diffs_metadata.json?w=1');
  });

  it('resumes when the Changes tab opens after the overview went idle', async () => {
    loadContentScript({ url: 'https://gitlab.com/group/project/-/merge_requests/7', metadata: ['a.lock.json'] });
    await settle();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);

    const file = rapidDiff('a.lock.json');
    navigateTo(MERGE_REQUEST_URL);
    await settle();

    expect(viewed(file)).toBe(true);
  });

  it('ignores a hash-only navigation such as a file tree click', async () => {
    rapidDiff('a.lock.json');
    const { fetch } = loadContentScript({ metadata: ['a.lock.json'] });
    await settle();

    navigateTo(`${MERGE_REQUEST_URL}#file-a`);
    const laterFile = rapidDiff('b.lock.json');
    await settle();

    expect(fetch).toHaveBeenCalledOnce();
    expect(viewed(laterFile)).toBe(false);
  });

  it('refetches the file list but keeps handled files when the whitespace filter changes', async () => {
    const file = rapidDiff('a.lock.json');
    const { fetch } = loadContentScript({ metadata: ['a.lock.json'] });
    await settle();
    file.remove();

    navigateTo(`${MERGE_REQUEST_URL}?w=1`);
    const reRendered = rapidDiff('a.lock.json');
    await settle();

    expect(fetch).toHaveBeenLastCalledWith('/group/project/-/merge_requests/7/diffs_metadata.json?w=1');
    expect(viewed(reRendered)).toBe(false);
  });

  it('stays idle after a navigation while switched off', async () => {
    const file = rapidDiff('a.lock.json');
    const { fetch } = loadContentScript({ storage: { enabled: false }, metadata: ['a.lock.json'] });
    await settle();

    navigateTo(`${MERGE_REQUEST_URL}?w=1`);
    await settle();

    expect(viewed(file)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
