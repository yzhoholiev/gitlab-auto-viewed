# GitLab Auto Viewed

Chrome / Edge extension that ticks **Viewed** on merge request files matching your patterns (lock files by default), so they collapse and drop out of the review.

Works on `gitlab.com` and self-hosted GitLab, with both diff UIs: the classic diffs view and Rapid Diffs.

## Install

1. Open `edge://extensions` (or `chrome://extensions`) and enable **Developer mode**.
2. **Load unpacked** → select the `src` folder. From WSL that is `\\wsl.localhost\<distro>\home\<user>\src\gitlab-auto-viewed\src`.
3. Open any merge request's **Changes** tab.

After pulling changes, press **Reload** on the extension card, then refresh open merge request tabs: tabs opened before the reload keep the old code.

## Patterns

Click the toolbar icon to edit them; the `?` next to **patterns** shows this syntax. One pattern per line:

| Line | Matches |
| --- | --- |
| `*.lock.json` | Glob on the file name |
| `*.{yml,yaml}` | Glob with alternatives, without `/` or nested `{}` inside them |
| `src/**/Migrations/*.Designer.cs` | Glob with a slash, matched against the full path |
| `/package-lock.json` | Leading slash anchors to the repository root |
| `vendor/` | Trailing slash: everything inside any `vendor` folder |
| `/vendor/` | Leading slash too: only the root `vendor` folder (as in `.gitignore`, a slash at the start or in the middle anchors the pattern) |
| `re:\.snap$` | Regular expression after `re:`, searched anywhere in the full path |
| `# comment` | Ignored |

Patterns that would match every file, such as `*`, `**`, `/` or an empty `re:`, are rejected. The **Try a path** box shows whether a path would be ticked. **Reset** only refills the editor with the defaults; nothing changes until you press **Save**.

## Behaviour

- The page stops watching once every matching file in the merge request is ticked. The file list comes from the page's own `diffs_metadata.json`, requested with the page's URL query. If it lists a file that never renders, for example because GitLab keeps the whitespace setting outside the URL, the page watches until the idle stop below instead of stopping early. It also stops after 10 minutes without a new file appearing, which covers an Overview tab left open, a file list that cannot be read, and files that never render. The next scroll after such an idle stop resumes it, and so does an in-page navigation that changes the path or query, such as opening the Changes tab or changing a diff filter. A query change refetches the file list. Hash-only changes, such as file-tree clicks, are ignored. The classic diffs view only renders files near the viewport, so files further down are ticked as you scroll to them, and each newly rendered file restarts the 10 minutes.
- The switch in the popup turns the extension off: open pages stop watching and the toolbar icon shows `off`. Turning it back on restarts open merge request pages without a reload.
- A file is ticked at most once per run, so unticking one by hand sticks while you review. Reloading the page, switching the extension or the host off and on, or saving patterns starts a new run, which ticks every matching file again.
- GitLab resets Viewed when a later push changes the file, and the extension ticks it again on the next visit.

## Self-hosted GitLab

`gitlab.com` works out of the box. For another instance, open the popup, type its address (or paste any URL from it) under **gitlab hosts** and press **add**. The browser asks for access to that site only.

- Opening the popup on a self-hosted merge request pre-fills that site.
- Reload merge request tabs that were open before the host was added.
- Each host has its own switch, including `gitlab.com`. A switched-off host keeps its access, so switching it back on needs no new prompt and restarts open merge request pages on it.
- **remove**, or revoking site access in the browser's extension settings, stops the extension on that host for pages loaded afterwards. Reload merge request tabs already open there. **remove** also clears the host's switch, so nothing is left behind. Adding a host from the popup switches it on.
- Edge keeps a removed site listed under the extension's site access, with its toggle off. The access itself is gone: `(await chrome.permissions.getAll()).origins` in the popup's DevTools console lists only what the extension can still reach.

## Appearance

The popup and the toolbar icon follow the browser's light or dark mode. Chrome and Edge have no manifest setting for theme-specific icons, so:

- on browser start and install, a hidden offscreen page reads `prefers-color-scheme` once and closes;
- open merge request pages and the popup report later changes, and only message the background when the icon does not already match.

A theme change made while no merge request page or popup is open shows on the icon the next time one opens.

## Performance

The content script is built to cost nothing once its work is done:

- It scans only `<input>` elements through a live collection, never the diff contents, and only after a DOM change, at most once per 250 ms.
- It fetches `diffs_metadata.json` once, and only after diffs render, so Overview, Commits and Pipelines views make no extra request.
- It disconnects its `MutationObserver` once every matching file is ticked, or after 10 minutes without a new file. After an idle stop, a single self-removing `scroll` listener waits to resume it. A Navigation API `currententrychange` listener restarts it only when the path or query string changes.
- Between a DOM change and the scan it queues, the observer is disconnected. A connected subtree observer makes Chrome build a record for every node Rapid Diffs streams in, which measured as roughly doubling the parse time of 1,000 streamed files (117–134 ms without the extension, 241–282 ms observed throughout, 133–137 ms with the pause). That cost is charged to the page's parser, so the profiler-based budgets cannot see it. `performance.spec.js` instead counts the records the observer receives while 53k nodes stream in, through a breakpoint whose condition counts and never pauses (about 83k records without the pause, 6–10k with it, budget half the node count), and `content.test.js` pins the pause with a fake observer.
- When the extension or the host is switched off it does no scanning, observing or fetching. Only the theme reporter runs: one `storage.local` read per page load, and a message to the background only if the toolbar icon's colour scheme is wrong.

## Development

| Path | Contents |
| --- | --- |
| `src/` | The extension, loaded unpacked as is; no build step |
| `tests/` | Vitest unit suites run in happy-dom against a fake `chrome.*` API |
| `tests/e2e/` | Playwright suites that load `src/` into Chromium against a fake gitlab.com |

```sh
pnpm install
pnpm test               # unit tests
pnpm test:watch         # unit tests on every change
pnpm test:e2e:install   # once: download Playwright's Chromium
pnpm test:e2e           # browser tests, about 1 minute
```

The browser suites cover:

- **Behaviour** (`extension.spec.js`): both diff views, the popup, the off badge, and the toolbar icon in light and dark mode.
- **Switches** (`switches.spec.js`): the main switch overrides host switches, switching on reruns open merge requests, a host switched off and on reruns, saved patterns rerun, and nothing that is viewed is ever un-viewed. Self-hosted hosts need a browser permission prompt Playwright cannot answer, so the same rules are unit-tested in `content.test.js` instead.
- **Performance** (`performance.spec.js`): the V8 sampling profiler counts only time whose call stack passes through the extension's own scripts, so page noise does not count. On a 400k-node diffs page the budgets are 100 ms for the first pass, 5 ms over 5 s once every file is ticked or while switched off, and 250 ms over 5 s on a 1,000-file merge request that is still waiting for a matching file to render. The first-pass and still-waiting budgets run in both diff views. It also checks that the file list is requested once and only on the diffs view. A separate check counts the DOM change records the observer receives while files stream in, which does not depend on machine speed.

The extension files are plain scripts rather than modules, so `tests/support/load-scripts.js` runs them in a fresh function scope per test with the fake `chrome` passed in. Keep `node_modules` out of `src/`: Chrome refuses to load an unpacked extension containing files whose names start with `_`.

## License

[MIT](LICENSE)
