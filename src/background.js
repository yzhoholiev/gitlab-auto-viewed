importScripts('hosts.js', 'patterns.js');

const SELF_HOSTED_SCRIPT_ID = 'self-hosted-gitlab';
const CONTENT_SCRIPTS = chrome.runtime.getManifest().content_scripts[0].js;
const OFF_BADGE_COLOR = '#6E7681';

async function syncContentScripts() {
  const [origins, [registered]] = await Promise.all([
    selfHostedOrigins(),
    chrome.scripting.getRegisteredContentScripts({ ids: [SELF_HOSTED_SCRIPT_ID] }),
  ]);
  const matches = origins.map(mergeRequestMatch);

  if (!matches.length) {
    if (registered) await chrome.scripting.unregisterContentScripts({ ids: [SELF_HOSTED_SCRIPT_ID] });
    return;
  }

  const script = { id: SELF_HOSTED_SCRIPT_ID, matches, js: CONTENT_SCRIPTS, runAt: 'document_idle' };
  await (registered ? chrome.scripting.updateContentScripts([script]) : chrome.scripting.registerContentScripts([script]));
}

/**
 * Wraps a task so overlapping calls run one after another and failures are logged.
 */
function serialized(task, failureMessage) {
  let queue = Promise.resolve();
  return (...args) => {
    queue = queue.then(() => task(...args)).catch((error) => console.error(failureMessage, error));
    return queue;
  };
}

function showOffBadge(enabled) {
  chrome.action.setBadgeBackgroundColor({ color: OFF_BADGE_COLOR });
  chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
}

async function restoreOffBadge() {
  const { enabled } = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  showOffBadge(enabled);
}

function toolbarIcons(scheme) {
  return { 16: `icons/${scheme}/icon16.png`, 32: `icons/${scheme}/icon32.png` };
}

async function storedIconScheme() {
  const { iconScheme } = await chrome.storage.local.get({ iconScheme: null });
  return iconScheme;
}

async function showSchemeIcon(scheme) {
  if ((await storedIconScheme()) === scheme) return;
  await chrome.action.setIcon({ path: toolbarIcons(scheme) });
  await chrome.storage.local.set({ iconScheme: scheme });
}

const inIconOrder = serialized((update) => update(), 'Updating the toolbar icon failed');

async function restoreSchemeIcon() {
  const iconScheme = await storedIconScheme();
  if (iconScheme) await chrome.action.setIcon({ path: toolbarIcons(iconScheme) });
}

async function colorSchemeProbeOpen() {
  const probes = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return probes.length > 0;
}

async function openColorSchemeProbe() {
  try {
    if (await colorSchemeProbeOpen()) return;
    await chrome.offscreen.createDocument({
      url: 'probe.html',
      reasons: ['MATCH_MEDIA'],
      justification: 'Read the browser colour scheme to pick the toolbar icon',
    });
  } catch (error) {
    console.error('Reading the browser colour scheme failed', error);
  }
}

let colorSchemeProbe;

/**
 * Opens a hidden page that reports the browser colour scheme once.
 */
function probeColorScheme() {
  colorSchemeProbe ??= openColorSchemeProbe().finally(() => {
    colorSchemeProbe = undefined;
  });
  return colorSchemeProbe;
}

async function closeColorSchemeProbe() {
  try {
    await colorSchemeProbe;
    if (await colorSchemeProbeOpen()) await chrome.offscreen.closeDocument();
  } catch (error) {
    console.error('Closing the colour scheme probe failed', error);
  }
}

const queueContentScriptSync = serialized(syncContentScripts, 'Registering self-hosted content scripts failed');

chrome.runtime.onInstalled.addListener(() => {
  queueContentScriptSync();
  probeColorScheme();
});
chrome.runtime.onStartup.addListener(probeColorScheme);
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'color-scheme' && message.type !== 'color-scheme-probe') return;
  inIconOrder(() => showSchemeIcon(message.scheme));
  if (message.type === 'color-scheme-probe') closeColorSchemeProbe();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) showOffBadge(changes.enabled.newValue ?? DEFAULT_SETTINGS.enabled);
});
chrome.permissions.onAdded.addListener(queueContentScriptSync);
chrome.permissions.onRemoved.addListener(queueContentScriptSync);

restoreOffBadge();
inIconOrder(restoreSchemeIcon);
