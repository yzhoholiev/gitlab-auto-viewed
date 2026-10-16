import { describe, expect, it } from 'vitest';
import { loadScripts } from './support/load-scripts.js';

const { parsePattern, patternList, activePatterns, compilePatterns, DEFAULT_SETTINGS } = loadScripts(['patterns.js'], {
  expose: ['parsePattern', 'patternList', 'activePatterns', 'compilePatterns', 'DEFAULT_SETTINGS'],
});

function matches(pattern, path) {
  return parsePattern(pattern)(path);
}

describe('parsePattern', () => {
  it.each([
    ['*.lock.json', 'src/Acme.Foo/packages.Acme.Foo.lock.json'],
    ['*.lock.json', 'packages.lock.json'],
    ['yarn.lock', 'web/app/yarn.lock'],
    ['src/**/*.cs', 'src/A/B/C.cs'],
    ['src/**/*.cs', 'src/C.cs'],
    ['*.{yml,yaml}', 'ci/deploy.yaml'],
    ['/*', 'Makefile'],
    ['{src,tests}/**/*.lock.json', 'tests/A/packages.A.lock.json'],
    ['/package-lock.json', 'package-lock.json'],
    ['/scripts/setup', 'scripts/setup'],
    ['file?.txt', 'docs/file1.txt'],
    ['re:\\.snap$', 'tests/__snapshots__/Foo.snap'],
    ['re:lock', 'pnpm-lock.yaml'],
    ['re:^docs/', 'docs/guide.md'],
    ['/vendor/', 'vendor/acme/lib.js'],
    ['vendor/', 'vendor/readme.md'],
    ['vendor/', 'packages/app/vendor/lib.js'],
    ['src/vendor/', 'src/vendor/lib.js'],
    ['/docs/i', 'docs/i'],
  ])('matches %s against %s', (pattern, path) => {
    expect(matches(pattern, path)).toBe(true);
  });

  it.each([
    ['*.lock.json', 'src/lock.json.cs'],
    ['*.lock.json', 'src/A/packages.lock.json/readme.md'],
    ['src/**/*.cs', 'tests/C.cs'],
    ['*.{yml,yaml}', 'ci/deploy.json'],
    ['/*', 'src/Makefile'],
    ['/package-lock.json', 'web/package-lock.json'],
    ['/scripts/setup', 'tools/scripts/setup'],
    ['/assets/img', 'assets/other.png'],
    ['file?.txt', 'docs/file10.txt'],
    ['re:\\.snap$', 'tests/Foo.SNAP'],
    ['/vendor/', 'src/vendored.ts'],
    ['/vendor/', 'lib/vendor/x.js'],
    ['vendor/', 'src/vendored/lib.js'],
    ['src/vendor/', 'lib/src/vendor/lib.js'],
    ['/vendor/', 'vendor'],
    ['/docs/i', 'docs/guide.md'],
    ['a.b', 'axb'],
  ])('does not match %s against %s', (pattern, path) => {
    expect(matches(pattern, path)).toBe(false);
  });

  it.each([
    ['re:(unclosed', 'Invalid regular expression'],
    ['re:', 'this pattern would match every file'],
    ['?*', 'this pattern would match every file'],
    ['/', 'this pattern would match every file'],
    ['**/', 'this pattern would match every file'],
    ['*', 'this pattern would match every file'],
    ['**', 'this pattern would match every file'],
    ['*.[ch]', 'character classes are not supported'],
    ['*.{yml', 'unclosed {'],
    ['*.{json,{yml,yaml}}', '{...} cannot contain / or another {'],
    ['{yarn.lock,tools/x.lock}', '{...} cannot contain / or another {'],
  ])('rejects %s', (pattern, message) => {
    expect(() => parsePattern(pattern)).toThrow(message);
  });
});

describe('pattern list', () => {
  it('reads the one-pattern-per-line text earlier versions saved, without blank lines and comments', () => {
    expect(patternList('\n# lock files\n   \n*.lock.json\n  # another\nyarn.lock\n')).toEqual([
      { pattern: '*.lock.json', enabled: true },
      { pattern: 'yarn.lock', enabled: true },
    ]);
  });

  it('applies only the switched-on patterns', () => {
    const list = [
      { pattern: '*.lock.json', enabled: true },
      { pattern: '*.snap', enabled: false },
    ];

    expect(activePatterns(list)).toEqual(['*.lock.json']);
  });

  it('skips a stored pattern that no longer compiles and keeps the rest', () => {
    const matchers = compilePatterns(['*.lock.json', '*.[ch]', 'yarn.lock']);

    expect(matchers).toHaveLength(2);
    expect(matchers[1]('web/yarn.lock')).toBe(true);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('starts enabled on every host with lock file patterns', () => {
    const matchers = compilePatterns(activePatterns(DEFAULT_SETTINGS.patterns));

    expect(DEFAULT_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_SETTINGS.disabledSites).toEqual([]);
    expect(matchers).toHaveLength(DEFAULT_SETTINGS.patterns.length);
    expect(
      ['a/packages.lock.json', 'package-lock.json', 'pnpm-lock.yaml', 'web/yarn.lock'].every((path) => matchers.some((m) => m(path))),
    ).toBe(true);
  });
});
