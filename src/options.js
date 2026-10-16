const SAVED_MESSAGE_MS = 1500;

const enabled = document.getElementById('enabled');
const enabledLabel = document.getElementById('enabledLabel');
const patternRows = document.getElementById('patternList');
const patternForm = document.getElementById('addPattern');
const patternInput = document.getElementById('patternInput');
const patternStatus = document.getElementById('patternStatus');
const count = document.getElementById('count');
const enabledStatus = document.getElementById('enabledStatus');
const sample = document.getElementById('sample');
const sampleResult = document.getElementById('sampleResult');
const hosts = document.getElementById('hosts');
const hostForm = document.getElementById('addHost');
const hostInput = document.getElementById('hostInput');
const hostStatus = document.getElementById('hostStatus');

function showMessage(target, message, state) {
  target.textContent = message;
  target.dataset.state = state;
}

async function saveSettings(items, target) {
  try {
    await chrome.storage.sync.set(items);
  } catch (error) {
    showMessage(target, `not saved: ${error.message}`, 'error');
    return false;
  }

  showMessage(target, 'saved', 'saved');
  setTimeout(() => {
    if (target.dataset.state === 'saved') showMessage(target, '', 'saved');
  }, SAVED_MESSAGE_MS);
  return true;
}

let shownPatterns = [];

function render(settings) {
  showEnabled(settings.enabled);
  drawPatterns(patternList(settings.patterns));
}

function showEnabled(on) {
  enabled.checked = on;
  enabledLabel.textContent = on ? 'on' : 'off';
}

function refreshSample() {
  const path = withoutLeadingSlash(sample.value.trim());
  if (!path) {
    sampleResult.textContent = '';
    delete sampleResult.dataset.state;
    return;
  }

  const matching = shownPatterns.filter((item) => item.matches?.(path));
  const active = matching.find((item) => item.enabled);
  if (active) showMessage(sampleResult, `match: ${active.pattern} ticks it as Viewed`, 'match');
  else if (matching.length) showMessage(sampleResult, `no match: ${matching[0].pattern} would, but it is off`, 'none');
  else showMessage(sampleResult, 'no match', 'none');
}

/**
 * Redraws a list of rows, keeping keyboard focus on the switch that had it.
 */
function replaceKeepingFocus(list, rows) {
  const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  list.replaceChildren(...rows);
  if (focusKey) [...list.querySelectorAll('input')].find((input) => input.dataset.focusKey === focusKey)?.focus();
}

function smallSwitch(checked, label, focusKey, onChange) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset.focusKey = focusKey;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(input.checked));

  const track = document.createElement('span');
  track.className = 'track';

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch small';
  switchLabel.append(input, track);
  return switchLabel;
}

function rowName(text) {
  const name = document.createElement('span');
  name.className = 'host-name';
  name.textContent = text;
  return name;
}

function linkButton(text, onClick) {
  const button = document.createElement('button');
  button.className = 'link';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

async function updatePatterns(change) {
  const { patterns } = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return saveSettings({ patterns: change(patternList(patterns)) }, patternStatus);
}

function withPattern(items, pattern, patternEnabled) {
  const others = items.filter((item) => item.pattern !== pattern);
  return items.length === others.length
    ? [...items, { pattern, enabled: patternEnabled }]
    : items.map((item) => (item.pattern === pattern ? { pattern, enabled: patternEnabled } : item));
}

function patternItem({ pattern, enabled: patternEnabled }) {
  const item = document.createElement('li');
  item.classList.toggle('disabled', !patternEnabled);
  item.append(
    rowName(pattern),
    linkButton('remove', () => updatePatterns((items) => items.filter((other) => other.pattern !== pattern))),
    smallSwitch(patternEnabled, `Tick files matching ${pattern}`, pattern, (on) => updatePatterns((items) => withPattern(items, pattern, on))),
  );
  return item;
}

function drawPatterns(items) {
  shownPatterns = items.map((item) => ({ ...item, matches: compilePatterns([item.pattern])[0] }));
  replaceKeepingFocus(patternRows, items.map(patternItem));
  count.textContent = `${activePatterns(items).length} of ${items.length} on`;
  refreshSample();
}

async function addPattern() {
  const pattern = patternInput.value.trim();
  if (!pattern) return;

  try {
    parsePattern(pattern);
  } catch (error) {
    showMessage(patternStatus, `${pattern}: ${error.message}`, 'error');
    return;
  }

  if (await updatePatterns((items) => withPattern(items, pattern, true))) patternInput.value = '';
}

function withDefaultPatterns(items) {
  return DEFAULT_PATTERNS.reduce((list, pattern) => (list.some((item) => item.pattern === pattern) ? list : withPattern(list, pattern, true)), items);
}

function withSiteEnabled(disabledSites, site, siteEnabled) {
  const otherSites = disabledSites.filter((disabledSite) => disabledSite !== site);
  return siteEnabled ? otherSites : [...otherSites, site];
}

async function setSiteEnabled(site, siteEnabled) {
  const { disabledSites } = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return saveSettings({ disabledSites: withSiteEnabled(disabledSites, site, siteEnabled) }, hostStatus);
}

function siteSwitch(site, label, disabledSites) {
  return smallSwitch(!disabledSites.includes(site), `Auto-tick on ${label}`, site, (on) => setSiteEnabled(site, on));
}

function builtInTag() {
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = 'built-in';
  return tag;
}

function removeButton(origin) {
  const host = originHost(origin);
  return linkButton('remove', async () => {
    const removed = await chrome.permissions.remove({ origins: [origin] }).catch(() => false);
    if (removed) {
      if (!(await setSiteEnabled(originSite(origin), true))) return;
      showMessage(hostStatus, `removed ${host} and its site access`, 'match');
    } else {
      showMessage(hostStatus, `could not remove site access for ${host}`, 'error');
    }
  });
}

function hostItem({ site, label, action }, disabledSites) {
  const item = document.createElement('li');
  item.classList.toggle('disabled', disabledSites.includes(site));
  item.append(rowName(label), action, siteSwitch(site, label, disabledSites));
  return item;
}

function displayName(origin) {
  return origin.startsWith('http:') ? originSite(origin) : originHost(origin);
}

let latestHostsRender = 0;

function drawHosts(disabledSites, origins) {
  replaceKeepingFocus(hosts, [
    hostItem({ site: GITLAB_COM_SITE, label: GITLAB_COM, action: builtInTag() }, disabledSites),
    ...origins.map((origin) => hostItem({ site: originSite(origin), label: displayName(origin), action: removeButton(origin) }, disabledSites)),
  ]);
}

async function renderHosts() {
  const request = ++latestHostsRender;
  const [{ disabledSites }, origins] = await Promise.all([chrome.storage.sync.get(DEFAULT_SETTINGS), selfHostedOrigins()]);
  if (request === latestHostsRender) drawHosts(disabledSites, origins);
}

function looksLikeGitLab(url) {
  return new URL(url).pathname.includes('/-/');
}

function suggestCurrentSite(tab, origins) {
  if (!tab?.url?.startsWith('http') || !looksLikeGitLab(tab.url)) return;

  const origin = hostOrigin(tab.url);
  if (originHost(origin) === GITLAB_COM || origins.includes(origin)) return;

  hostInput.value = originSite(origin);
  showMessage(hostStatus, 'this site looks like GitLab, press add to enable it', 'hint');
}

async function addHost() {
  let origin;
  try {
    origin = hostOrigin(hostInput.value);
  } catch (error) {
    showMessage(hostStatus, error.message, 'error');
    return;
  }

  if (originHost(origin) === GITLAB_COM) {
    showMessage(hostStatus, 'gitlab.com is built in', 'none');
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) {
    showMessage(hostStatus, 'access not granted', 'error');
    return;
  }

  if (!(await selfHostedOrigins()).includes(origin)) {
    showMessage(hostStatus, 'the browser already allows this through a wider site-access rule; set its site access to "On specific sites" to add hosts', 'error');
    return;
  }

  if (!(await setSiteEnabled(originSite(origin), true))) return;
  hostInput.value = '';
  showMessage(hostStatus, `added, reload open merge requests on ${originHost(origin)}`, 'match');
}

document.getElementById('restoreDefaults').addEventListener('click', () => updatePatterns(withDefaultPatterns));

enabled.addEventListener('change', () => {
  showEnabled(enabled.checked);
  saveSettings({ enabled: enabled.checked }, enabledStatus);
});
sample.addEventListener('input', refreshSample);
patternForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addPattern();
});
hostForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addHost();
});

chrome.permissions.onAdded.addListener(renderHosts);
chrome.permissions.onRemoved.addListener(renderHosts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.disabledSites) renderHosts();
  if (changes.patterns) drawPatterns(patternList(changes.patterns.newValue ?? DEFAULT_SETTINGS.patterns));
  if (changes.enabled) showEnabled(changes.enabled.newValue ?? DEFAULT_SETTINGS.enabled);
});

/**
 * Reads everything the popup shows in one parallel batch and draws it in a single pass.
 */
async function openPopup() {
  const request = ++latestHostsRender;
  const [settings, origins, [tab]] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    selfHostedOrigins(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  render(settings);
  if (request === latestHostsRender) drawHosts(settings.disabledSites, origins);
  suggestCurrentSite(tab, origins);
}

document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
openPopup();
