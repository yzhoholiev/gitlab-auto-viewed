import { vi } from 'vitest';
import { readSource } from './load-scripts.js';

const MANIFEST = JSON.parse(readSource('manifest.json'));

function fakeEvent() {
  const listeners = [];
  return {
    addListener: vi.fn((listener) => listeners.push(listener)),
    dispatch: (...args) => Promise.all(listeners.map((listener) => listener(...args))),
  };
}

function fakeStorageArea(name, onChanged, initial) {
  let data = { ...initial };
  const area = {
    failWith: undefined,
    data: () => data,
    get: vi.fn((defaults, callback) => {
      const items = structuredClone({ ...defaults, ...data });
      callback?.(items);
      return Promise.resolve(items);
    }),
    set: vi.fn(async (items) => {
      if (area.failWith) throw new Error(area.failWith);
      data = { ...data, ...structuredClone(items) };
      const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
      await onChanged.dispatch(changes, name);
    }),
  };
  return area;
}

function fakeStorage(syncInitial, localInitial) {
  const onChanged = fakeEvent();
  const sync = fakeStorageArea('sync', onChanged, syncInitial);
  return { sync, local: fakeStorageArea('local', onChanged, localInitial), onChanged, data: sync.data };
}

function fakeScripting() {
  const registered = new Map();
  return {
    registered,
    getRegisteredContentScripts: vi.fn(async ({ ids }) => ids.filter((id) => registered.has(id)).map((id) => registered.get(id))),
    registerContentScripts: vi.fn(async (scripts) => {
      for (const script of scripts) {
        if (registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
        registered.set(script.id, script);
      }
    }),
    updateContentScripts: vi.fn(async (scripts) => {
      for (const script of scripts) registered.set(script.id, { ...registered.get(script.id), ...script });
    }),
    unregisterContentScripts: vi.fn(async ({ ids }) => ids.forEach((id) => registered.delete(id))),
  };
}

function fakePermissions(origins) {
  const granted = new Set(origins);
  const onAdded = fakeEvent();
  const onRemoved = fakeEvent();
  return {
    granted,
    onAdded,
    onRemoved,
    grantNext: true,
    getAll: vi.fn(async () => ({ origins: [...granted] })),
    request: vi.fn(async function ({ origins: requested }) {
      if (!this.grantNext) return false;
      requested.forEach((origin) => granted.add(origin));
      await onAdded.dispatch({ origins: requested });
      return true;
    }),
    removeNext: true,
    remove: vi.fn(async function ({ origins: removed }) {
      if (!this.removeNext) return false;
      removed.forEach((origin) => granted.delete(origin));
      await onRemoved.dispatch({ origins: removed });
      return true;
    }),
  };
}

/**
 * In-memory stand-in for the parts of the chrome.* extension API the extension uses.
 */
export function fakeChrome({
  storage = {},
  localStorage = {},
  origins = ['https://gitlab.com/*/-/merge_requests/*'],
  activeTabUrl,
  version = '1.0.0',
} = {}) {
  const runtime = {
    id: 'test-extension',
    getManifest: () => ({ ...MANIFEST, version }),
    getContexts: vi.fn(async () => []),
    sendMessage: vi.fn(async () => {}),
    onInstalled: fakeEvent(),
    onStartup: fakeEvent(),
    onMessage: fakeEvent(),
  };

  return {
    runtime,
    storage: fakeStorage(storage, localStorage),
    permissions: fakePermissions(origins),
    scripting: fakeScripting(),
    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setIcon: vi.fn(async () => {}),
    },
    offscreen: { createDocument: vi.fn(async () => {}), closeDocument: vi.fn(async () => {}) },
    tabs: {
      query: vi.fn(async () => (activeTabUrl ? [{ url: activeTabUrl }] : [])),
    },
  };
}
