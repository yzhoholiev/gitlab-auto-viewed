const SAVED_MESSAGE_MS = 1500;

const enabled = document.getElementById('enabled');
const enabledLabel = document.getElementById('enabledLabel');
const patterns = document.getElementById('patterns');
const count = document.getElementById('count');
const status = document.getElementById('status');
const enabledStatus = document.getElementById('enabledStatus');
const errors = document.getElementById('errors');
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

function render(settings) {
  showEnabled(settings.enabled);
  patterns.value = settings.patterns;
  refreshFeedback();
}

function showEnabled(on) {
  enabled.checked = on;
  enabledLabel.textContent = on ? 'on' : 'off';
}

function refreshFeedback() {
  const parsed = parsePatterns(patterns.value);
  errors.textContent = parsed.errors.join('\n');
  count.textContent = `${parsed.matchers.length} active`;

  const path = withoutLeadingSlash(sample.value.trim());
  if (!path) {
    sampleResult.textContent = '';
    delete sampleResult.dataset.state;
    return;
  }

  const matches = parsed.matchers.some((matcher) => matcher(path));
  showMessage(sampleResult, matches ? 'match: would be ticked as Viewed' : 'no match', matches ? 'match' : 'none');
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
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !disabledSites.includes(site);
  input.dataset.site = site;
  input.setAttribute('aria-label', `Auto-tick on ${label}`);
  input.addEventListener('change', () => setSiteEnabled(site, input.checked));

  const track = document.createElement('span');
  track.className = 'track';

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch small';
  switchLabel.append(input, track);
  return switchLabel;
}

function builtInTag() {
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = 'built-in';
  return tag;
}

function removeButton(origin) {
  const host = originHost(origin);
  const remove = document.createElement('button');
  remove.className = 'link';
  remove.textContent = 'remove';
  remove.addEventListener('click', async () => {
    const removed = await chrome.permissions.remove({ origins: [origin] }).catch(() => false);
    if (removed) {
      if (!(await setSiteEnabled(originSite(origin), true))) return;
      showMessage(hostStatus, `removed ${host} and its site access`, 'match');
    } else {
      showMessage(hostStatus, `could not remove site access for ${host}`, 'error');
    }
  });
  return remove;
}

function hostItem({ site, label, action }, disabledSites) {
  const name = document.createElement('span');
  name.className = 'host-name';
  name.textContent = label;

  const item = document.createElement('li');
  item.classList.toggle('disabled', disabledSites.includes(site));
  item.append(name, action, siteSwitch(site, label, disabledSites));
  return item;
}

function displayName(origin) {
  return origin.startsWith('http:') ? originSite(origin) : originHost(origin);
}

let latestHostsRender = 0;

function drawHosts(disabledSites, origins) {
  const focusedSite = hosts.contains(document.activeElement) ? document.activeElement.dataset.site : undefined;
  hosts.replaceChildren(
    hostItem({ site: GITLAB_COM_SITE, label: GITLAB_COM, action: builtInTag() }, disabledSites),
    ...origins.map((origin) => hostItem({ site: originSite(origin), label: displayName(origin), action: removeButton(origin) }, disabledSites)),
  );
  if (focusedSite) [...hosts.querySelectorAll('input')].find((input) => input.dataset.site === focusedSite)?.focus();
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

document.getElementById('save').addEventListener('click', () => {
  if (parsePatterns(patterns.value).errors.length) {
    showMessage(status, 'fix the errors above first', 'error');
    return;
  }
  saveSettings({ patterns: patterns.value }, status);
});

document.getElementById('reset').addEventListener('click', () => {
  patterns.value = DEFAULT_SETTINGS.patterns;
  refreshFeedback();
  showMessage(status, 'defaults loaded, save to apply', 'pending');
});

enabled.addEventListener('change', () => {
  showEnabled(enabled.checked);
  saveSettings({ enabled: enabled.checked }, enabledStatus);
});
patterns.addEventListener('input', refreshFeedback);
sample.addEventListener('input', refreshFeedback);
hostForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addHost();
});

chrome.permissions.onAdded.addListener(renderHosts);
chrome.permissions.onRemoved.addListener(renderHosts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.disabledSites) renderHosts();
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
