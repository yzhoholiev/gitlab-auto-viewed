import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from './support/load-scripts.js';

const manifest = JSON.parse(readSource('manifest.json'));
const sourceFile = (path) => join(import.meta.dirname, '../src', path);

function referencedFiles() {
  return [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.options_ui.page,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ];
}

describe('manifest', () => {
  it.each(referencedFiles())('points at an existing file: %s', (path) => {
    expect(existsSync(sourceFile(path))).toBe(true);
  });

  it.each(['light', 'dark'])('has every toolbar icon size in the %s set', (scheme) => {
    for (const size of Object.keys(manifest.action.default_icon)) {
      expect(existsSync(sourceFile(`icons/${scheme}/icon${size}.png`))).toBe(true);
    }
  });

  it('loads the theme reporter in the popup', () => {
    expect(readSource('options.html')).toContain('<script src="theme.js"></script>');
  });

  it('runs on gitlab.com merge request pages without asking', () => {
    expect(manifest.content_scripts[0].matches).toEqual(['https://gitlab.com/*/-/merge_requests/*']);
  });
});
