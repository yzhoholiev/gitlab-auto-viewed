const IDLE_LIMIT_MS = 10 * 60 * 1000;
const SCAN_DELAY_MS = 250;
const VIEWED_CHECKBOX = 'input[data-viewed-checkbox], input[data-testid="fileReviewCheckbox"], [data-testid="fileReviewCheckbox"] input[type="checkbox"]';
const OBSERVED_CHANGES = { childList: true, subtree: true, attributes: true, attributeFilter: ['data-path', 'data-file-data'] };

const mergeRequestPath = location.pathname.match(/^.*\/-\/merge_requests\/\d+/)?.[0];
const site = `${location.protocol}//${location.hostname}`;
const pageInputs = document.getElementsByTagName('input');

let settings = { enabled: false, patterns: undefined, matchers: [] };
let fileList = { query: undefined, request: undefined, paths: null };
let currentPage = location.pathname + location.search;
let pendingPaths = null;
let watching = false;
let idleDeadline;
let scanQueued = false;

/**
 * Files ticked since the settings last changed, so a file the reviewer unticks stays unticked across re-renders.
 */
const handledFiles = new Set();

let settledInputs = new WeakMap();
const observer = new MutationObserver(scheduleScan);

function extensionUnloaded() {
  return !chrome.runtime?.id;
}

function matchesPatterns(path) {
  return settings.matchers.some((matches) => matches(path));
}

function diffFilePath(file) {
  return file.new_path ?? file.old_path;
}

/**
 * Paths of every changed file, from the diffs page's own metadata (the public diffs API also returns every diff's text).
 */
function fetchChangedPaths() {
  return fetch(`${mergeRequestPath}/diffs_metadata.json${location.search}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((metadata) => metadata?.diff_files?.map(diffFilePath) ?? null)
    .catch(() => null);
}

function currentFileList() {
  return fileList.query === location.search ? fileList.paths : null;
}

function requestChangedPaths() {
  const query = location.search;
  if (fileList.request && fileList.query === query) return;

  const request = fetchChangedPaths().then((paths) => {
    if (request !== fileList.request) return;
    fileList.paths = paths;
    refreshPendingPaths();
    if (finishedTicking()) stopWatching();
  });
  fileList = { query, request, paths: null };
}

function refreshPendingPaths() {
  const paths = currentFileList();
  pendingPaths = paths && new Set(paths.filter((path) => matchesPatterns(path) && !handledFiles.has(path)));
}

function finishedTicking() {
  return pendingPaths?.size === 0;
}

/**
 * Restarts watching after an in-page navigation such as opening the Changes tab.
 */
function restartAfterNavigation() {
  const page = location.pathname + location.search;
  if (page === currentPage) return;
  currentPage = page;
  startWatching();
}

function rapidDiffPath(file) {
  try {
    return diffFilePath(JSON.parse(file.dataset.fileData));
  } catch {
    return undefined;
  }
}

function classicDiffPath(file) {
  const title = file.querySelector('.file-title-name');
  return file.dataset.path || title?.getAttribute('title') || title?.textContent.trim();
}

function filePath(file) {
  return file.dataset.fileData ? rapidDiffPath(file) : classicDiffPath(file);
}

function resumeAfterIdle() {
  if (!watching) startWatching();
}

function stopForIdle() {
  stopWatching();
  addEventListener('scroll', resumeAfterIdle, { capture: true, once: true, passive: true });
}

function restartIdleDeadline() {
  clearTimeout(idleDeadline);
  idleDeadline = setTimeout(stopForIdle, IDLE_LIMIT_MS);
}

function stopWatching() {
  watching = false;
  observer.disconnect();
  clearTimeout(idleDeadline);
}

function startWatching() {
  stopWatching();
  removeEventListener('scroll', resumeAfterIdle, { capture: true });
  if (!settings.enabled || !settings.matchers.length) return;

  watching = true;
  settledInputs = new WeakMap();
  restartIdleDeadline();
  refreshPendingPaths();
  scheduleScan();
}

function fileIdentity(file) {
  return file.dataset.fileData ?? file.dataset.path ?? classicDiffPath(file);
}

/**
 * Handles a checkbox the first time it is seen for its current file and reports whether it was new.
 */
function processInput(input) {
  const settled = settledInputs.get(input);
  if (settled === null || (settled && settled.identity === fileIdentity(settled.file))) return false;

  const file = input.matches(VIEWED_CHECKBOX) && input.closest('diff-file, .diff-file');
  if (!file) {
    settledInputs.set(input, null);
    return false;
  }

  const path = filePath(file);
  if (!path) return false;

  settledInputs.set(input, { file, identity: fileIdentity(file) });
  if (!handledFiles.has(path) && matchesPatterns(path)) {
    handledFiles.add(path);
    pendingPaths?.delete(path);
    if (!input.checked) input.click();
  }
  return true;
}

function scan() {
  if (extensionUnloaded()) {
    stopWatching();
    return;
  }
  if (!watching) return;

  let foundNewCheckbox = false;
  for (const input of pageInputs) {
    if (processInput(input)) foundNewCheckbox = true;
  }

  if (foundNewCheckbox) {
    restartIdleDeadline();
    requestChangedPaths();
  }
  if (finishedTicking()) stopWatching();
}

/**
 * Queues a scan and stops observing until it runs, because a connected observer makes the browser record every node GitLab streams in.
 */
function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  observer.disconnect();
  setTimeout(() => {
    scanQueued = false;
    if (watching) observer.observe(document.body, OBSERVED_CHANGES);
    scan();
  }, SCAN_DELAY_MS);
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    const enabled = stored.enabled && !stored.disabledSites.includes(site);
    const patterns = activePatterns(patternList(stored.patterns));
    const patternsKey = patterns.join('\n');
    if (settings.enabled === enabled && settings.patterns === patternsKey) return;

    settings = { enabled, patterns: patternsKey, matchers: compilePatterns(patterns) };
    handledFiles.clear();
    startWatching();
  });
}

if (mergeRequestPath) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') loadSettings();
  });
  globalThis.navigation?.addEventListener('currententrychange', restartAfterNavigation);
  loadSettings();
}
