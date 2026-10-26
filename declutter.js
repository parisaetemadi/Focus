// Hides the parts of a site you asked to lose. Runs at document_start on every
// site in the catalog, independent of focus sessions.

const STYLE_ID = 'just-focus-declutter';
const siteRules = rulesForHost(location.hostname);

function buildCss(enabled) {
  const selectors = siteRules
    .filter((rule) => enabled[rule.id])
    .flatMap((rule) => rule.css);
  if (!selectors.length) return '';
  return `${selectors.join(',\n')} { display: none !important; }`;
}

function apply(enabled) {
  const css = buildCss(enabled);
  let style = document.getElementById(STYLE_ID);
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    // head doesn't exist yet at document_start.
    (document.head || document.documentElement).append(style);
  }
  style.textContent = css;
}

// A Shorts URL opened directly isn't a feed item to hide — send it to the
// normal player instead, where the video is the same but the reel isn't.
function escapeShorts() {
  const match = location.pathname.match(/^\/shorts\/([\w-]+)/);
  if (match) location.replace(`/watch?v=${match[1]}${location.hash}`);
}

if (siteRules.length) {
  chrome.storage.local.get('declutter').then(({ declutter }) => {
    const enabled = { ...defaultDeclutter(), ...declutter };
    apply(enabled);
    if (enabled['yt-shorts'] && location.hostname.endsWith('youtube.com')) {
      escapeShorts();
      // YouTube navigates without reloading, so catch later Shorts too.
      window.addEventListener('yt-navigate-finish', escapeShorts);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.declutter) return;
    apply({ ...defaultDeclutter(), ...changes.declutter.newValue });
  });
}
