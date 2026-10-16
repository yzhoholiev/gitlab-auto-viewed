const DEFAULT_SETTINGS = {
  enabled: true,
  disabledSites: [],
  patterns: [
    '# lock files',
    '*.lock.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ].join('\n'),
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

function parsePatterns(text) {
  const matchers = [];
  const errors = [];
  for (const line of text.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    try {
      matchers.push(parsePattern(line));
    } catch (error) {
      errors.push(`${line}: ${error.message}`);
    }
  }
  return { matchers, errors };
}
