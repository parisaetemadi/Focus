// Focus time — turns app limits and Focus now into declarativeNetRequest
// redirect rules.
//
// One list of apps, each with minutes a day. Two ways one gets blocked:
//   limit — its minutes for today are spent. Nothing in the UI lifts that: it
//           stands until midnight, and a limit you loosen loosens tomorrow.
//   focus — Focus now is on, which blocks every app on the list until you
//           stop it.

const TICK_ALARM = 'focus-tick';
const DAY_ALARM = 'focus-day';

const TICK_MINUTES = 0.5; // Chrome won't repeat an alarm faster than 30s
const MAX_STEP = 120000;  // a longer gap than this was sleep, not screen time
const IDLE_AFTER = 60;    // seconds without input before time stops counting

// Minutes a day, per site. Spend them and the site is gone until midnight.
const DEFAULT_LIMITS = {
  'x.com': 20,
  'instagram.com': 20,
  'tiktok.com': 5
};

// Domains that are the same app, and so share one budget.
const ALIASES = { 'twitter.com': 'x.com' };

// "https://www.Reddit.com/r/all" -> "reddit.com"
function normalizeSite(input) {
  let site = String(input).trim().toLowerCase();
  if (!site) return '';
  site = site.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site) ? site : '';
}

function canonical(site) {
  return ALIASES[site] ?? site;
}

// Every domain that spends one site's budget: x.com also means twitter.com.
function domainsFor(site) {
  const twins = Object.entries(ALIASES)
    .filter(([, target]) => target === site)
    .map(([alias]) => alias);
  return [site, ...twins];
}

function cleanLimits(input) {
  const limits = {};
  for (const [raw, value] of Object.entries(input || {})) {
    const site = canonical(normalizeSite(raw));
    const minutes = Math.round(Number(value));
    if (!site || !Number.isFinite(minutes) || minutes < 0) continue;
    limits[site] = Math.min(minutes, 1440);
  }
  return limits;
}

function todayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

// Reads state and rolls the day over: today's spending starts at zero, and any
// loosened limit that was parked yesterday takes effect now.
async function readState() {
  const store = await chrome.storage.local.get([
    'focus', 'limits', 'pending', 'usage', 'tracking'
  ]);

  const day = todayKey();
  const focus = Boolean(store.focus);
  let limits = store.limits && typeof store.limits === 'object'
    ? store.limits
    : { ...DEFAULT_LIMITS };
  let pending = store.pending ?? null;
  let usage = store.usage ?? null;
  const tracking = store.tracking ?? null;

  const patch = {};
  if (!usage || usage.day !== day) {
    usage = { day, spent: {} };
    patch.usage = usage;
  }
  if (pending && pending.day !== day) {
    limits = cleanLimits(pending.limits);
    pending = null;
    patch.limits = limits;
    patch.pending = null;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);

  return { focus, limits, pending, usage, tracking };
}

function spentOn(usage, site) {
  return usage.spent[site] ?? 0;
}

// The sites whose budget is gone, by canonical name.
function exhausted(limits, usage) {
  return Object.keys(limits).filter((site) => spentOn(usage, site) >= limits[site] * 60000);
}

// Every domain to block right now, and why — a spent limit outranks Focus
// now, because it is the one that cannot be called off.
function blockList({ focus, limits, usage }) {
  const blocked = new Map();
  if (focus) {
    for (const site of Object.keys(limits)) {
      for (const domain of domainsFor(site)) blocked.set(domain, { why: 'focus', site });
    }
  }
  // `site` is whose budget the domain spends: twitter.com spends x.com's.
  for (const site of exhausted(limits, usage)) {
    for (const domain of domainsFor(site)) blocked.set(domain, { why: 'limit', site });
  }
  return [...blocked].map(([domain, info]) => ({ domain, ...info }));
}

function blockedUrl(domain, why) {
  const query = `site=${encodeURIComponent(domain)}&why=${why}`;
  return chrome.runtime.getURL(`blocked.html?${query}`);
}

function ruleFor({ domain, why }, id) {
  return {
    id,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: `/blocked.html?site=${encodeURIComponent(domain)}&why=${why}` }
    },
    // "||domain" matches the domain and every subdomain of it.
    condition: { urlFilter: `||${domain}`, resourceTypes: ['main_frame'] }
  };
}

// Which entry of a block list a URL belongs to, or null.
function matchBlocked(url, blocked) {
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    host = parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  return blocked.find(({ domain }) => host === domain || host.endsWith(`.${domain}`)) ?? null;
}

// Net rules only catch requests that reach the network, and they never catch a
// page that is already open — so walk the tabs too.
async function enforceTabs(blocked) {
  if (!blocked.length) return;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    const hit = matchBlocked(tab.url, blocked);
    if (hit) chrome.tabs.update(tab.id, { url: blockedUrl(hit.domain, hit.why) });
  }
}

function fingerprint(rules) {
  return rules
    .map((rule) => `${rule.condition.urlFilter} ${rule.action.redirect.extensionPath}`)
    .sort()
    .join('\n');
}

async function syncRules() {
  const state = await readState();
  const blocked = blockList(state);

  const wanted = blocked.map((entry, i) => ruleFor(entry, i + 1));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  // The popup asks for state every second; only write when something moved.
  if (fingerprint(existing) !== fingerprint(wanted)) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: wanted
    });
  }

  await syncAlarms();
  await enforceTabs(blocked);
  return blocked;
}

// A standing alarm at midnight, so a spent limit lifts itself when the day
// turns over even if the browser sits untouched.
async function syncAlarms() {
  if (!(await chrome.alarms.get(DAY_ALARM))) {
    await chrome.alarms.create(DAY_ALARM, { when: nextMidnight(), periodInMinutes: 1440 });
  }
}

// --- Counting the minutes --------------------------------------------------

// The limited site the user is actually looking at: front tab, focused window,
// someone at the keyboard. Anything else and the clock stops.
async function activeSite(limits) {
  const domains = Object.keys(limits).flatMap(domainsFor);
  if (!domains.length) return null;
  let window;
  try {
    window = await chrome.windows.getLastFocused();
  } catch {
    return null;
  }
  if (!window?.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (!tab?.url) return null;
  if ((await chrome.idle.queryState(IDLE_AFTER)) !== 'active') return null;
  const hit = matchBlocked(tab.url, domains.map((domain) => ({ domain, why: 'limit' })));
  return hit ? canonical(hit.domain) : null;
}

// Bank the time since the last tick against the site it was spent on, then
// start the clock on whatever is in front now.
async function tick() {
  const { limits, usage, tracking } = await readState();
  const now = Date.now();
  const site = await activeSite(limits);

  // Time that started yesterday is yesterday's, and the day it belonged to is
  // over — crediting it to today would eat into a fresh budget.
  if (tracking?.site && tracking.day === usage.day) {
    const step = Math.min(Math.max(0, now - tracking.since), MAX_STEP);
    if (step > 0) usage.spent[tracking.site] = spentOn(usage, tracking.site) + step;
  }

  await chrome.storage.local.set({
    usage,
    tracking: site ? { site, since: now, day: usage.day } : null
  });

  if (site) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
  } else {
    await chrome.alarms.clear(TICK_ALARM);
  }

  return syncRules();
}

// --- Focus now and limits --------------------------------------------------

// Focus now has no timer: it is on until you turn it off.
async function setFocus(on) {
  await chrome.storage.local.set({ focus: Boolean(on) });
  await syncRules();
}

// Tighter takes effect now; looser waits for tomorrow. That is the whole point
// of a limit — the version of you that set it gets the last word today.
async function setLimits(input) {
  const want = cleanLimits(input);
  const { limits } = await readState();
  const today = {};
  for (const site of new Set([...Object.keys(limits), ...Object.keys(want)])) {
    const strictest = Math.min(limits[site] ?? Infinity, want[site] ?? Infinity);
    if (Number.isFinite(strictest)) today[site] = strictest;
  }
  const deferred = JSON.stringify(today) !== JSON.stringify(want);
  await chrome.storage.local.set({
    limits: today,
    pending: deferred ? { day: todayKey(), limits: want } : null
  });
  await syncRules();
  return { limits: today, pending: deferred ? want : null };
}

async function state() {
  const stored = await readState();
  const { focus, limits, pending, usage } = stored;
  return {
    focus,
    limits,
    pending: pending?.limits ?? null,
    spent: usage.spent,
    resetsAt: nextMidnight(),
    // canonical sites whose budget is gone, and every domain blocked right now
    blocked: exhausted(limits, usage),
    entries: blockList(stored)
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    if (msg.type === 'getState') {
      await tick(); // so the numbers in the popup are the numbers right now
      respond(await state());
      return;
    }
    if (msg.type === 'setFocus') {
      await setFocus(msg.on);
      respond(await state());
      return;
    }
    if (msg.type === 'setLimits') {
      await setLimits(msg.limits);
      respond(await state());
      return;
    }
    respond({ error: `unknown message: ${msg.type}` });
  })();
  return true; // keep the channel open for the async respond
});

// Anything that changes which page is in front changes whose minutes are
// running, so each one banks the time and re-checks the limits.
chrome.tabs.onActivated.addListener(() => tick());
chrome.tabs.onRemoved.addListener(() => tick());
chrome.windows.onFocusChanged.addListener(() => tick());
chrome.idle.onStateChanged.addListener(() => tick());

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? (changeInfo.status === 'loading' ? tab.url : null);
  if (!url) return;
  const blocked = blockList(await readState());
  const hit = matchBlocked(url, blocked);
  if (hit) {
    chrome.tabs.update(tabId, { url: blockedUrl(hit.domain, hit.why) });
    return;
  }
  if (tab.active) await tick();
});

chrome.alarms.onAlarm.addListener(() => tick());
chrome.runtime.onStartup.addListener(() => tick());
chrome.runtime.onInstalled.addListener(async () => {
  const { limits } = await chrome.storage.local.get('limits');
  if (!limits || typeof limits !== 'object') {
    await chrome.storage.local.set({ limits: { ...DEFAULT_LIMITS } });
  }
  // The timed-session version kept a second list; there is one list now.
  await chrome.storage.local.remove(['session', 'sites']);
  await tick();
});
