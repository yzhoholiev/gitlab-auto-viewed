import { describe, expect, it } from 'vitest';
import { loadScripts } from './support/load-scripts.js';

const { parsePatterns, DEFAULT_SETTINGS } = loadScripts(['patterns.js'], { expose: ['parsePatterns', 'DEFAULT_SETTINGS'] });

function matches(pattern, path) {
  const { matchers, errors } = parsePatterns(pattern);
  expect(errors).toEqual([]);
  return matchers.some((matcher) => matcher(path));
}

describe('parsePatterns', () => {
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

  it('ignores blank lines and comments', () => {
    const { matchers, errors } = parsePatterns('\n# lock files\n   \n*.lock.json\n  # another\n');

    expect(errors).toEqual([]);
    expect(matchers).toHaveLength(1);
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
  ])('reports %s as an error', (pattern, message) => {
    const { matchers, errors } = parsePatterns(pattern);

    expect(matchers).toEqual([]);
    expect(errors).toEqual([expect.stringContaining(message)]);
    expect(errors[0]).toMatch(new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
  });

  it('keeps valid lines when another line is invalid', () => {
    const { matchers, errors } = parsePatterns('*.lock.json\n*.[ch]\nyarn.lock');

    expect(matchers).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('starts enabled on every host with lock file patterns', () => {
    const { matchers, errors } = parsePatterns(DEFAULT_SETTINGS.patterns);

    expect(DEFAULT_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_SETTINGS.disabledSites).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      ['a/packages.lock.json', 'package-lock.json', 'pnpm-lock.yaml', 'web/yarn.lock'].every((path) => matchers.some((m) => m(path))),
    ).toBe(true);
  });
});
