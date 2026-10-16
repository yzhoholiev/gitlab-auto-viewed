import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(import.meta.dirname, '../../src');

export function readSource(file) {
  return readFileSync(join(SOURCE, file), 'utf8');
}

/**
 * Runs extension scripts in a fresh function scope and returns the named top-level bindings.
 */
export function loadScripts(files, { globals = {}, expose = [] } = {}) {
  const code = files.map(readSource).join('\n');
  const names = Object.keys(globals);
  const run = new Function(...names, `${code}\nreturn { ${expose.join(', ')} };`);
  return run(...names.map((name) => globals[name]));
}
