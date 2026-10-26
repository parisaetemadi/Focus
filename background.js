// Focus time — turns a focus session into declarativeNetRequest redirect rules.
// A session is either timed ({ endsAt }) or open-ended ({ endsAt: null }).

const TICK_ALARM = 'focus-tick';
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
  await syncBadge(active ? session : null);
  await syncAlarms(active ? session : null);
}

function minutesLeft(session) {
  if (!session || session.endsAt === null) return null;
  return Math.max(0, Math.ceil((session.endsAt - Date.now()) / 60000));
}

async function syncBadge(session) {
  if (!session) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const left = minutesLeft(session);
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  // Minutes while they fit, hours past that — a badge holds about four glyphs.
  const text = left === null ? 'ON' : left > 99 ? `${Math.ceil(left / 60)}h` : String(left);
  await chrome.action.setBadgeText({ text });
}

async function syncAlarms(session) {
  await chrome.alarms.clear(TICK_ALARM);
  await chrome.alarms.clear(END_ALARM);
  if (!session) return;
  // The tick keeps the badge countdown honest while the popup is closed.
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (session.endsAt !== null) {
    await chrome.alarms.create(END_ALARM, { when: session.endsAt });
  }
}

// Sites already open when a session starts are only caught on reload.
async function reloadBlockedTabs(sites) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    let host;
    try {
      host = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (sites.some((site) => host === site || host.endsWith(`.${site}`))) {
      chrome.tabs.reload(tab.id);
    }
  }
}

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
