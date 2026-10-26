// Focus time — turns a focus session into declarativeNetRequest redirect rules.
// A session is either timed ({ endsAt }) or open-ended ({ endsAt: null }).

const END_ALARM = 'focus-end';

const DEFAULT_SITES = [
  'instagram.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'tiktok.com',
  'reddit.com',
  'youtube.com'
];

// "https://www.Reddit.com/r/all" -> "reddit.com"
function normalizeSite(input) {
  let site = String(input).trim().toLowerCase();
  if (!site) return '';
  site = site.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site) ? site : '';
}

function cleanSites(list) {
  const seen = new Set();
  for (const raw of list) {
    const site = normalizeSite(raw);
    if (site) seen.add(site);
  }
  return [...seen];
}

async function readState() {
  const { session = null, sites } = await chrome.storage.local.get(['session', 'sites']);
  return { session, sites: Array.isArray(sites) ? sites : DEFAULT_SITES };
}

function isActive(session) {
  if (!session) return false;
  return session.endsAt === null || session.endsAt > Date.now();
}

function ruleFor(site, id) {
  return {
    id,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: `/blocked.html?site=${encodeURIComponent(site)}` }
    },
    // "||site" matches the domain and every subdomain of it.
    condition: { urlFilter: `||${site}`, resourceTypes: ['main_frame'] }
  };
}

async function syncRules() {
  const { session, sites } = await readState();
  const active = isActive(session);

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: active ? sites.map((site, i) => ruleFor(site, i + 1)) : []
  });

  if (!active && session) await chrome.storage.local.remove('session');
  await syncAlarms(active ? session : null);
}

// No badge: the toolbar icon stays as drawn, and the popup carries the state.
// So the only alarm needed is the one that ends a timed session.
async function syncAlarms(session) {
  await chrome.alarms.clear(END_ALARM);
  if (session && session.endsAt !== null) {
    await chrome.alarms.create(END_ALARM, { when: session.endsAt });
  }
}

// Which blocked site a URL belongs to, or null.
function matchSite(url, sites) {
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    host = parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  return sites.find((site) => host === site || host.endsWith(`.${site}`)) ?? null;
}

function blockedUrl(site) {
  return chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(site)}`);
}

// Sites already open when a session starts are only caught on reload.
async function reloadBlockedTabs(sites) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (matchSite(tab.url, sites)) chrome.tabs.reload(tab.id);
  }
}

// Net rules only see requests that reach the network. A site with its own
// service worker (x.com is one) can answer a navigation from its cache, and
// back/forward restores skip the network too — so watch the tab as well.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? (changeInfo.status === 'loading' ? tab.url : null);
  if (!url) return;
  const { session, sites } = await readState();
  if (!isActive(session)) return;
  const site = matchSite(url, sites);
  if (site) chrome.tabs.update(tabId, { url: blockedUrl(site) });
});

async function start(minutes) {
  const session = {
    startedAt: Date.now(),
    endsAt: minutes ? Date.now() + minutes * 60000 : null
  };
  await chrome.storage.local.set({ session });
  await syncRules();
  const { sites } = await readState();
  await reloadBlockedTabs(sites);
  return session;
}

async function stop() {
  await chrome.storage.local.remove('session');
  await syncRules();
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    if (msg.type === 'getState') {
      const { session, sites } = await readState();
      const live = isActive(session) ? session : null;
      if (session && !live) await syncRules();
      respond({ session: live, sites });
      return;
    }
    if (msg.type === 'start') {
      respond({ session: await start(msg.minutes || null) });
      return;
    }
    if (msg.type === 'stop') {
      await stop();
      respond({ session: null });
      return;
    }
    if (msg.type === 'setSites') {
      const sites = cleanSites(msg.sites || []);
      await chrome.storage.local.set({ sites });
      await syncRules();
      const { session } = await readState();
      if (isActive(session)) await reloadBlockedTabs(sites);
      respond({ sites });
      return;
    }
    respond({ error: `unknown message: ${msg.type}` });
  })();
  return true; // keep the channel open for the async respond
});

chrome.alarms.onAlarm.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);
chrome.runtime.onInstalled.addListener(async () => {
  const { sites } = await chrome.storage.local.get('sites');
  if (!Array.isArray(sites)) await chrome.storage.local.set({ sites: DEFAULT_SITES });
  await syncRules();
});
