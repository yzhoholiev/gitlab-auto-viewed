const scheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
chrome.runtime.sendMessage({ type: 'color-scheme-probe', scheme });
