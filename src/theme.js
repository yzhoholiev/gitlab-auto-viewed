const darkScheme = matchMedia('(prefers-color-scheme: dark)');

function currentScheme() {
  return darkScheme.matches ? 'dark' : 'light';
}

function ignoreUnreachableBackground() {}

function sendColorScheme(scheme) {
  chrome.runtime.sendMessage({ type: 'color-scheme', scheme }).catch(ignoreUnreachableBackground);
}

/**
 * Tells the background which toolbar icon set to show.
 */
function reportColorScheme() {
  if (!chrome.runtime?.id) {
    darkScheme.removeEventListener('change', reportColorScheme);
    return;
  }

  const scheme = currentScheme();
  chrome.storage.local.get({ iconScheme: null }, ({ iconScheme }) => {
    if (iconScheme !== scheme) sendColorScheme(scheme);
  });
}

darkScheme.addEventListener('change', reportColorScheme);
requestAnimationFrame(() => setTimeout(reportColorScheme));
