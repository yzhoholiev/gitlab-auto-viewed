const MERGE_REQUEST = 'https://gitlab.com/group/project/-/merge_requests';
const servedContexts = new WeakSet();

function diffRows(lines) {
  return Array.from({ length: lines }, (_, i) => `<tr><td>${i}</td><td>${i}</td><td><span>"Package.${i}": "1.${i}.0",</span></td></tr>`).join('');
}

function rapidDiffFile(path, lines, checked) {
  const fileData = JSON.stringify({ old_path: path, new_path: path }).replaceAll("'", '&#39;');
  return `<diff-file data-file-data='${fileData}'><header><h2>${path}</h2><input type="checkbox" data-viewed-checkbox${checked ? ' checked' : ''}></header><table>${diffRows(lines)}</table></diff-file>`;
}

function classicDiffFile(path, lines, checked) {
  return `<div class="diff-file" data-path="${path}"><div class="file-title">${path}<input type="checkbox" data-testid="fileReviewCheckbox"${checked ? ' checked' : ''}></div><table>${diffRows(lines)}</table></div>`;
}

function htmlPage(body, script = '') {
  return `<!doctype html><html><body><main>${body}</main><aside id="live"></aside><script>${script}</script></body></html>`;
}

/**
 * Renders the checkboxes disabled and enables them later, the way GitLab does once it restores each file's saved Viewed state.
 */
function withLateCheckboxes(body, enableAfterMs) {
  const disabled = body.replaceAll('<input type="checkbox"', '<input type="checkbox" disabled');
  const script = `setTimeout(() => document.querySelectorAll('input[disabled]').forEach((input) => (input.disabled = false)), ${enableAfterMs});`;
  return htmlPage(disabled, script);
}

/**
 * Serves a fake gitlab.com merge request (overview, diffs page and file list) to every page in the context.
 */
export async function serveMergeRequest(context, { id = 1, paths, rendered = paths, viewed = [], lines = 20, view = 'rapid', enableCheckboxesAfterMs }) {
  if (!servedContexts.has(context)) {
    servedContexts.add(context);
    await context.route('https://gitlab.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  }

  const renderFile = view === 'rapid' ? rapidDiffFile : classicDiffFile;
  const body = rendered.map((path) => renderFile(path, lines, viewed.includes(path))).join('');
  const diffFiles = paths.map((path) => ({ old_path: path, new_path: path }));

  await context.route(`${MERGE_REQUEST}/${id}/diffs_metadata.json*`, (route) => route.fulfill({ json: { diff_files: diffFiles } }));
  await context.route(`${MERGE_REQUEST}/${id}/diffs`, (route) =>
    route.fulfill({ contentType: 'text/html', body: enableCheckboxesAfterMs === undefined ? htmlPage(body) : withLateCheckboxes(body, enableCheckboxesAfterMs) }),
  );
  await context.route(`${MERGE_REQUEST}/${id}`, (route) => route.fulfill({ contentType: 'text/html', body: htmlPage('<p>Overview</p>') }));
  return `${MERGE_REQUEST}/${id}/diffs`;
}

export function diffFilesHtml(paths) {
  return paths.map((path) => rapidDiffFile(path, 20, false)).join('');
}

/**
 * Streams diff files into the live page through an adopted parser document, the way Rapid Diffs does, and returns the page's element count.
 */
export function streamDiffFiles(page, html) {
  return page.evaluate(async (streamed) => {
    const chunkLength = 16 * 1024;
    const parser = document.implementation.createHTMLDocument('stream');
    parser.open();
    parser.write('<streaming-element>');
    document.querySelector('main').appendChild(document.adoptNode(parser.querySelector('streaming-element')));
    for (let i = 0; i < streamed.length; i += chunkLength) {
      parser.write(streamed.slice(i, i + chunkLength));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    parser.write('</streaming-element>');
    parser.close();
    return document.getElementsByTagName('*').length;
  }, html);
}

/**
 * Renders another file into the page, the way the diffs view does as the reviewer scrolls.
 */
export function renderDiffFile(page, path) {
  return page.evaluate(
    ({ path, html }) => document.querySelector('main').insertAdjacentHTML('beforeend', html),
    { path, html: rapidDiffFile(path, 20, false) },
  );
}

export function viewedStates(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('diff-file, .diff-file')].map((file) => [
        file.dataset.path ?? JSON.parse(file.dataset.fileData).new_path,
        file.querySelector('input[type="checkbox"]')?.checked ?? null,
      ]),
    ),
  );
}

export async function viewedPaths(page) {
  return Object.entries(await viewedStates(page))
    .filter(([, viewed]) => viewed)
    .map(([path]) => path);
}

/**
 * Replaces a small node every 100 ms, standing in for GitLab's live timestamps and polling.
 */
export function startPageChurn(page) {
  return page.evaluate(() => {
    const live = document.getElementById('live');
    window.churn = setInterval(() => live.replaceChildren(Object.assign(document.createElement('time'), { textContent: Date.now() })), 100);
  });
}

export function stopPageChurn(page) {
  return page.evaluate(() => clearInterval(window.churn));
}
