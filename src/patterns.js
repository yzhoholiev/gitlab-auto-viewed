const DEFAULT_PATTERNS = ['*.lock.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

const DEFAULT_SETTINGS = {
  enabled: true,
  disabledSites: [],
  patterns: DEFAULT_PATTERNS.map((pattern) => ({ pattern, enabled: true })),
};

function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

const EVERY_FILE_SAMPLES = ['a', 'b/c', 'd/e/f.g', '.h', 'I/J.K', 'l/m/n/o'];

function braceGroup(glob, open) {
  const end = glob.indexOf('}', open);
  if (end === -1) throw new Error('unclosed {');

  const alternatives = glob.slice(open + 1, end);
  if (/[{/]/.test(alternatives)) throw new Error('{...} cannot contain / or another {');
  return { alternatives: alternatives.split(','), end };
}

function globSource(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('**', i)) {
      source += '.*';
      i += 1;
    } else if (glob[i] === '*') {
      source += '[^/]*';
    } else if (glob[i] === '?') {
      source += '[^/]';
    } else if (glob[i] === '{') {
      const { alternatives, end } = braceGroup(glob, i);
      source += `(?:${alternatives.map(globSource).join('|')})`;
      i = end;
    } else if (glob[i] === '[') {
      throw new Error('[...] character classes are not supported, use {a,b} or re:regex');
    } else {
      source += escapeRegExp(glob[i]);
    }
  }
  return source;
}

function globToRegExp(glob) {
  return new RegExp(`^${globSource(glob)}$`);
}

function fileName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

const REGEX_PREFIX = 're:';

function withoutLeadingSlash(glob) {
  return glob.replace(/^\/+/, '');
}

function compileRegex(source) {
  const regex = new RegExp(source);
  return (path) => regex.test(path);
}

function compilePattern(line) {
  if (line.startsWith(REGEX_PREFIX)) return compileRegex(line.slice(REGEX_PREFIX.length));

  const folder = line.endsWith('/');
  const anchored = line.slice(0, folder ? -1 : undefined).includes('/');
  const glob = withoutLeadingSlash(line);
  const regex = globToRegExp(folder ? `${anchored ? '' : '**/'}${glob}**` : glob);
  return anchored || folder ? (path) => regex.test(path) : (path) => regex.test(fileName(path));
}

function parsePattern(line) {
  const matcher = compilePattern(line);
  if (EVERY_FILE_SAMPLES.every(matcher)) throw new Error('this pattern would match every file');
  return matcher;
}

/**
 * The stored pattern list, also reading the one-pattern-per-line text that earlier versions saved.
 */
function patternList(stored) {
  if (typeof stored !== 'string') return stored;
  return stored
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((pattern) => ({ pattern, enabled: true }));
}

function activePatterns(list) {
  return list.filter((item) => item.enabled).map((item) => item.pattern);
}

function compilePatterns(patterns) {
  return patterns.flatMap((pattern) => {
    try {
      return [parsePattern(pattern)];
    } catch {
      return [];
    }
  });
}
