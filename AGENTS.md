# AGENTS.md

Guidance for coding agents working on GitLab Auto Viewed. Read `README.md` for what the extension does. This file covers how to change it safely.

## Commands

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test            # unit tests, a few seconds
corepack pnpm test:e2e        # Chromium with the extension loaded, a minute or two
corepack pnpm test:e2e:install   # once per machine
```

- pnpm is pinned through `packageManager` in `package.json`. Run it through corepack, never a global pnpm, npm or yarn.
- Dev dependencies are pinned to exact versions. Dependabot proposes bumps after a 7-day cooldown, so do not add brand-new releases by hand.
- Delete `test-results/` after an e2e run.
- A change is done when both suites pass. CI runs the same two commands on every push and pull request.

## Layout

| Path | Role |
| --- | --- |
| `src/` | The extension, loaded unpacked as is. There is no build step and no bundler. |
| `src/patterns.js` | Settings defaults and the pattern compiler. Shared by every other script. |
| `src/content.js` | Runs on merge request pages, finds Viewed checkboxes and ticks matching files. |
| `src/background.js` | Service worker: off badge, theme-matching toolbar icon, content-script registration for self-hosted hosts. |
| `src/options.html`, `src/options.js` | The toolbar popup, also used as the options page. |
| `src/hosts.js` | Host and origin helpers for the popup and the background. |
| `src/theme.js`, `src/probe.*` | Colour-scheme reporting from visible pages and from the offscreen probe. |
| `tests/` | Vitest in happy-dom, with a fake `chrome.*` in `tests/support/fake-chrome.js`. |
| `tests/e2e/` | Playwright against a fake gitlab.com served by routing in `tests/e2e/support/gitlab.js`. |
| `docs/` | README screenshots. Not shipped. |

## Constraints that are easy to break

- **Plain scripts, not modules.** Files in `src/` share one global scope per context, so load order matters:
  - content scripts load in the order of `content_scripts[0].js` in `manifest.json`;
  - the popup loads them through `<script>` tags in `options.html`;
  - the background loads them through `importScripts`.

  `background.js` registers self-hosted content scripts with the manifest's own list, so adding a content script means editing the manifest only. Tests run each file in a fresh function scope via `tests/support/load-scripts.js`. Expose a function there before asserting on it.
- **Never un-view a file.** The extension only ever clicks an unchecked Viewed box. A file the reviewer unticks stays unticked for the rest of the run. A run restarts only on a page load, a main or host switch going off and on, or a change to the switched-on patterns.
- **The content script is a hot path.** It runs on pages with hundreds of thousands of nodes. Keep per-scan work linear and cached: each checkbox is settled once in a `WeakMap`, scans read the live `getElementsByTagName('input')` collection, and the observer is disconnected while a scan is queued and once every matching file is ticked. Do not query diff contents, re-parse settings per scan or add listeners per file. `tests/e2e/performance.spec.js` holds the budgets. Run it after any change to `content.js`.
- **Storage shape.** `chrome.storage.sync` holds `enabled`, `disabledSites` (keyed `scheme://host`, port dropped) and `patterns` (an array of `{ pattern, enabled }`). `patternList()` still reads the newline-separated text that earlier versions stored. `chrome.storage.local` holds `iconScheme`. Read with `DEFAULT_SETTINGS` as the fallback, and write only the keys a change touches.
- **The popup must fit 460 × 600 without scrolling.** The pattern list scrolls after about five rows. `extension.spec.js` checks the size. Font ligatures are off on purpose, because programming fonts such as Cascadia Code draw `://` and `**/` as ligatures.
- **Permissions.** Self-hosted hosts use optional host permissions requested from the popup. Wildcard grants such as "on all sites" are ignored. Do not add required host permissions.
- **Keep `node_modules` out of `src/`.** Chrome refuses to load an unpacked extension that contains files whose names start with `_`.

## Real GitLab DOM

The fake GitLab in `tests/e2e/support/gitlab.js` mirrors what real pages render. Update both together when GitLab changes:

- **Rapid Diffs:** `diff-file[data-file-data]`, where the JSON carries `new_path` and `old_path`, and the checkbox is `input[data-viewed-checkbox]`.
- **Classic view:** `.diff-file[data-path]`, with the checkbox `input[data-testid="fileReviewCheckbox"]`. Older versions put the test id on a wrapper around the input. The title is `.file-title-name[title]`.
- **File list:** `diffs_metadata.json` next to the merge request URL, requested with the page's query string.

## Tests

- Name tests by behaviour (`ticks again a file the reviewer unticked when …`), not by function.
- Prefer one focused test per behaviour over parameterised tables. Add a case only when it exercises a different code path.
- Unit tests own the logic, including the self-hosted rules that Playwright cannot reach because it cannot answer permission prompts. E2E tests own the real browser integration and the performance budgets.

## Code style

- Match the surrounding code: small named functions, no classes, no dependencies at runtime.
- No comment unless it answers a question the code cannot, such as why a choice was made or where a magic value comes from. Doc comments are multi-line `/** … */` blocks that say what a function is for, in one sentence.
- User-facing popup text is lower-case and terse, matching the existing labels.

## Git

- `main` blocks force-pushes. Land every change as a new commit.
- Commit subjects are imperative and capitalised, with no trailing period. Commits carry no AI attribution.
