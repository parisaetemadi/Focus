// Focus time — turns app limits and Focus now into declarativeNetRequest
// redirect rules.
//
// One list of apps, each with minutes a day. Two ways one gets blocked:
//   limit — its minutes for today are spent. Nothing in the UI lifts that: it
//           stands until midnight, and a limit you loosen loosens tomorrow.
//   focus — Focus is on, which blocks every app on the list for the stretch
//           you picked, or until you stop it.

const TICK_ALARM = 'focus-tick';
const DAY_ALARM = 'focus-day';
const FOCUS_ALARM = 'focus-end';

const TICK_MINUTES = 0.5; // Chrome won't repeat an alarm faster than 30s
const MAX_STEP = 120000;  // a longer gap than this was sleep, not screen time
const IDLE_AFTER = 60;    // seconds without input before time stops counting
const KEEP_DAYS = 30;     // how many days of the record to hold on to

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
    'focus', 'limits', 'pending', 'usage', 'tracking', 'history'
  ]);

  const day = todayKey();
  const focus = readFocus(store.focus);
  let limits = store.limits && typeof store.limits === 'object'
    ? store.limits
    : { ...DEFAULT_LIMITS };
  let pending = store.pending ?? null;
  let usage = store.usage ?? null;
  const tracking = store.tracking ?? null;
  let history = store.history && typeof store.history === 'object' ? store.history : {};

  const patch = {};
  if (!usage || usage.day !== day) {
    // The day that just ended goes into the record before the counter resets.
    if (usage?.day && Object.keys(usage.spent ?? {}).length) {
      history = trimHistory({ ...history, [usage.day]: usage.spent });
      patch.history = history;
    }
    usage = { day, spent: {} };
    patch.usage = usage;
  }
  if (store.focus && !focus) patch.focus = null; // its stretch ran out
  if (pending && pending.day !== day) {
    limits = cleanLimits(pending.limits);
    pending = null;
    patch.limits = limits;
    patch.pending = null;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);

  return { focus, limits, pending, usage, tracking, history };
}

// A focus session, or null. `true` is how it was stored before focus had a
// clock; a stretch that has run out reads as no session at all.
function readFocus(stored) {
  if (!stored) return null;
  if (stored === true) return { endsAt: null };
  if (typeof stored !== 'object') return null;
  const endsAt = Number.isFinite(stored.endsAt) ? stored.endsAt : null;
  if (endsAt !== null && endsAt <= Date.now()) return null;
  return { endsAt };
}

// Oldest days fall off the end; the record is for looking back a little, not
// for keeping a year of it.
function trimHistory(history) {
  const days = Object.keys(history).sort().slice(-KEEP_DAYS);
  return Object.fromEntries(days.map((day) => [day, history[day]]));
}

// The last `count` days, today last, today's minutes live from the counter.
function recentDays(history, usage, count = 7) {
  const days = [];
  const start = new Date();
  start.setDate(start.getDate() - (count - 1));
  for (let i = 0; i < count; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = todayKey(date);
    days.push({ day, spent: (day === usage.day ? usage.spent : history[day]) ?? {} });
  }
  return days;
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

  await syncAlarms(state.focus);
  await enforceTabs(blocked);
  return blocked;
}

// A standing alarm at midnight, so a spent limit lifts itself when the day
// turns over even if the browser sits untouched, and one at the end of a timed
// focus session so it stops on time with the browser untouched too.
async function syncAlarms(focus) {
  if (!(await chrome.alarms.get(DAY_ALARM))) {
    await chrome.alarms.create(DAY_ALARM, { when: nextMidnight(), periodInMinutes: 1440 });
  }
  const end = await chrome.alarms.get(FOCUS_ALARM);
  if (focus?.endsAt) {
    if (end?.scheduledTime !== focus.endsAt) {
      await chrome.alarms.create(FOCUS_ALARM, { when: focus.endsAt });
    }
  } else if (end) {
    await chrome.alarms.clear(FOCUS_ALARM);
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

// Focus runs for the stretch you picked, or with no end until you stop it.
async function setFocus(on, minutes) {
  const length = Math.round(Number(minutes));
  const endsAt = Number.isFinite(length) && length > 0 ? Date.now() + length * 60000 : null;
  await chrome.storage.local.set({ focus: on ? { endsAt } : null });
  await syncRules();
}

// The one way off the list today. Everything else about a limit is one-way —
// you can tighten it now and only loosen it tomorrow — so taking an app off
// altogether is deliberate, and it leaves the day's record alone.
async function dropToday(input) {
  const site = canonical(normalizeSite(input));
  if (!site) return;
  const { limits, pending } = await readState();
  const patch = {};
  if (site in limits) {
    patch.limits = { ...limits };
    delete patch.limits[site];
  }
  if (pending && site in pending.limits) {
    const want = { ...pending.limits };
    delete want[site];
    patch.pending = { day: pending.day, limits: want };
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
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
  const { focus, limits, pending, usage, history } = stored;
  return {
    focus,
    limits,
    days: recentDays(history, usage),
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
      await setFocus(msg.on, msg.minutes);
      respond(await state());
      return;
    }
    if (msg.type === 'dropToday') {
      await dropToday(msg.site);
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
