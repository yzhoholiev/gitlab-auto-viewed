const GITLAB_COM = 'gitlab.com';
const GITLAB_COM_SITE = 'https://gitlab.com';

function originHost(origin) {
  return origin.split('/')[2];
}

function originSite(origin) {
  const [scheme, , host] = origin.split('/');
  return `${scheme}//${host.replace(/:\d+$/, '')}`;
}

function hostOrigin(input) {
  const text = input.trim();
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('not a valid host');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('only http and https hosts are supported');
  if (url.hostname.includes('*')) throw new Error('wildcards are not supported, add each host');
  return `${url.protocol}//${url.hostname}/*`;
}

function mergeRequestMatch(origin) {
  return origin.replace(/\*$/, '*/-/merge_requests/*');
}

function isWildcardOrigin(origin) {
  return originHost(origin).includes('*');
}

async function selfHostedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((origin) => originHost(origin) !== GITLAB_COM && !isWildcardOrigin(origin));
}
