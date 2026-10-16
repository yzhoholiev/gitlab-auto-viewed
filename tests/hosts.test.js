import { describe, expect, it } from 'vitest';
import { fakeChrome } from './support/fake-chrome.js';
import { loadScripts } from './support/load-scripts.js';

function loadHosts(chrome = fakeChrome()) {
  return loadScripts(['hosts.js'], {
    globals: { chrome },
    expose: ['originSite', 'hostOrigin', 'selfHostedOrigins'],
  });
}

describe('hostOrigin', () => {
  const { hostOrigin } = loadHosts();

  it.each([
    ['gitlab.acme.io', 'https://gitlab.acme.io/*'],
    ['  gitlab.acme.io  ', 'https://gitlab.acme.io/*'],
    ['GitLab.Acme.IO/', 'https://gitlab.acme.io/*'],
    ['https://gitlab.acme.io/group/project/-/merge_requests/3/diffs', 'https://gitlab.acme.io/*'],
    ['http://gitlab.local:8080/x', 'http://gitlab.local/*'],
  ])('turns %s into %s', (input, origin) => {
    expect(hostOrigin(input)).toBe(origin);
  });

  it.each([[''], ['has space'], ['https://']])('rejects %j as an invalid host', (input) => {
    expect(() => hostOrigin(input)).toThrow('not a valid host');
  });

  it('rejects schemes other than http and https', () => {
    expect(() => hostOrigin('ftp://files.acme.io')).toThrow('only http and https hosts are supported');
  });

  it.each([['*'], ['*.acme.io'], ['https://*.acme.io/group']])('rejects the wildcard host %s', (input) => {
    expect(() => hostOrigin(input)).toThrow('wildcards are not supported, add each host');
  });
});

describe('originSite', () => {
  const { originSite } = loadHosts();

  it.each([
    ['https://gitlab.acme.io/*', 'https://gitlab.acme.io'],
    ['http://gitlab.local/*', 'http://gitlab.local'],
    ['https://gitlab.com/*/-/merge_requests/*', 'https://gitlab.com'],
    ['https://git.corp:8443/*', 'https://git.corp'],
  ])('keys %s as %s', (origin, site) => {
    expect(originSite(origin)).toBe(site);
  });
});

describe('selfHostedOrigins', () => {
  it('lists every granted origin except gitlab.com', async () => {
    const chrome = fakeChrome({
      origins: ['https://gitlab.com/*/-/merge_requests/*', 'https://gitlab.acme.io/*', 'http://gitlab.local/*'],
    });

    expect(await loadHosts(chrome).selfHostedOrigins()).toEqual(['https://gitlab.acme.io/*', 'http://gitlab.local/*']);
  });

  it('leaves out wildcard grants', async () => {
    const chrome = fakeChrome({ origins: ['https://gitlab.com/*/-/merge_requests/*', 'https://*/*', 'http://*/*', 'https://gitlab.acme.io/*'] });

    expect(await loadHosts(chrome).selfHostedOrigins()).toEqual(['https://gitlab.acme.io/*']);
  });

});
