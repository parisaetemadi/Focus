// The popup is one screen: what is left of each app's day, and Focus now.
// The apps and their minutes are written as text under More — that list is
// the only place they are edited, and it saves itself.

const dot = document.getElementById('dot');
const status = document.getElementById('status');
const stale = document.getElementById('stale');
const empty = document.getElementById('empty');
const limitsBox = document.getElementById('limits');
const focusButton = document.getElementById('focus');
const planBox = document.getElementById('plan');
const pendingNote = document.getElementById('pending');
const historyBox = document.getElementById('history');

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function format(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = hours ? [hours, mins, secs] : [mins, secs];
  return parts.map((part, i) => (i ? String(part).padStart(2, '0') : part)).join(':');
}

// --- What is left of today -------------------------------------------------

const rows = new Map(); // site -> { row, fill, left }
let built = '';         // the set of apps the rows were built from

function buildLimits(limits) {
  rows.clear();
  limitsBox.replaceChildren();

  for (const site of Object.keys(limits).sort()) {
    const row = document.createElement('div');
    row.className = 'limit';

    const top = document.createElement('div');
    top.className = 'limit-top';
    const name = document.createElement('span');
    name.className = 'limit-name';
    name.textContent = site;
    const left = document.createElement('span');
    left.className = 'limit-left';
    top.append(name, left);

    const track = document.createElement('div');
    track.className = 'bar';
    const fill = document.createElement('div');
    track.append(fill);

    row.append(top, track);
    limitsBox.append(row);
    rows.set(site, { row, fill, left });
  }
  built = Object.keys(limits).sort().join(',');
}

function renderLimits(state) {
  const signature = Object.keys(state.limits).sort().join(',');
  if (signature !== built) buildLimits(state.limits);

  for (const [site, row] of rows) {
    const budget = (state.limits[site] ?? 0) * 60000;
    const spent = state.spent[site] ?? 0;
    const left = budget - spent;
    row.row.classList.toggle('out', left <= 0);
    row.fill.style.width = `${budget ? Math.min(100, (spent / budget) * 100) : 100}%`;
    row.left.textContent = left <= 0 ? 'back at midnight' : `${format(left)} left`;
  }

  const changes = state.pending
    ? [...new Set([...Object.keys(state.limits), ...Object.keys(state.pending)])]
      .sort()
      .filter((site) => state.pending[site] !== state.limits[site])
      .map((site) => (site in state.pending ? `${site} ${state.pending[site]}` : `${site} off`))
    : [];
  pendingNote.hidden = !changes.length;
  pendingNote.textContent = `From tomorrow: ${changes.join(', ')}.`;
}

// --- The record ------------------------------------------------------------

function human(ms) {
  const mins = Math.round(ms / 60000);
  if (!mins) return '—';
  const hours = Math.floor(mins / 60);
  if (!hours) return `${mins} min`;
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
}

function weekday(day) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date)
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

// One row per app: the week's total, and a bar per day on one shared scale,
// so a tall bar means the same thing in every row.
function renderHistory(state) {
  const apps = new Set(Object.keys(state.limits));
  for (const { spent } of state.days) for (const site of Object.keys(spent)) apps.add(site);

  const total = (site) => state.days.reduce((sum, d) => sum + (d.spent[site] ?? 0), 0);
  const peak = Math.max(
    ...state.days.flatMap(({ spent }) => [...apps].map((site) => spent[site] ?? 0)),
    60000
  );

  historyBox.replaceChildren();
  for (const site of [...apps].sort((a, b) => total(b) - total(a))) {
    const row = document.createElement('div');
    row.className = 'week';

    const top = document.createElement('div');
    top.className = 'limit-top';
    const name = document.createElement('span');
    name.className = 'limit-name';
    name.textContent = site;
    const sum = document.createElement('span');
    sum.className = 'limit-left';
    sum.textContent = human(total(site));
    top.append(name, sum);

    const spark = document.createElement('div');
    spark.className = 'spark';
    for (const { day, spent } of state.days) {
      const ms = spent[site] ?? 0;
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(3, (ms / peak) * 100)}%`;
      bar.classList.toggle('none', ms === 0);
      bar.title = `${weekday(day)} — ${human(ms)}`;
      spark.append(bar);
    }

    row.append(top, spark);
    historyBox.append(row);
  }
}

// --- The written list ------------------------------------------------------

function planText(limits) {
  return Object.keys(limits).sort().map((site) => `${site} ${limits[site]}`).join('\n');
}

// "x.com 20", "x.com: 20 min", "x.com" (keeps the minutes it already has).
function parsePlan(text, current) {
  const limits = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)[\s:,=|-]+(\d+)\s*(?:min[a-z]*)?$/i);
    const site = (match ? match[1] : trimmed).trim();
    const minutes = match ? Number(match[2]) : current[site];
    if (minutes === undefined) continue; // a new app with no number to go on
    limits[site] = minutes;
  }
  return limits;
}

planBox.addEventListener('change', async () => {
  apply(await send({ type: 'setLimits', limits: parsePlan(planBox.value, lastLimits) }));
});

// --- Focus now -------------------------------------------------------------

focusButton.addEventListener('click', async () => {
  apply(await send({ type: 'setFocus', on: !focusOn }));
});

let focusOn = false;
let lastLimits = {};

function apply(state) {
  focusOn = state.focus;
  lastLimits = state.limits;
  empty.hidden = Object.keys(state.limits).length > 0;

  const spent = Object.keys(state.limits).filter((site) => state.blocked.includes(site)).length;
  const on = state.focus || spent > 0;
  dot.classList.toggle('on', on);
  status.classList.toggle('on', on);
  if (state.focus) status.textContent = 'Focus on';
  else if (spent) status.textContent = spent === 1 ? '1 app spent' : `${spent} apps spent`;
  else status.textContent = 'Nothing spent yet';

  focusButton.textContent = state.focus ? 'Stop focus' : 'Focus now';
  focusButton.classList.toggle('stopping', state.focus);

  renderLimits(state);
  renderHistory(state);
  // Don't yank the list out from under the cursor mid-edit.
  if (document.activeElement !== planBox) planBox.value = planText(state.limits);
}

async function refresh() {
  let state;
  try {
    state = await send({ type: 'getState' });
  } catch {
    state = null;
  }
  // Chrome re-reads this popup from disk every time it opens, but only picks
  // up a new service worker when the extension is reloaded. An answer with no
  // limits in it is the old worker talking.
  if (!state || !state.limits) {
    stale.hidden = false;
    return;
  }
  stale.hidden = true;
  apply(state);
}

refresh();
// The minutes tick down while the popup is open, so keep asking.
setInterval(refresh, 1000);

// --- Hide feeds ------------------------------------------------------------
// One tick per kind of thing, covering every site that has one. Each is
// written straight to storage, so a choice made once is the choice every time
// any of those sites opens, until it is changed here.

const togglesBox = document.getElementById('toggles');

function renderToggles(enabled) {
  togglesBox.replaceChildren();
  for (const rule of HIDE_RULES) {
    const row = document.createElement('label');
    row.className = 'toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(enabled[rule.id]);
    box.dataset.id = rule.id;
    row.append(box, document.createTextNode(rule.label));
    togglesBox.append(row);
  }
}

async function readDeclutter() {
  const { declutter } = await chrome.storage.local.get('declutter');
  return readDeclutterSettings(declutter);
}

togglesBox.addEventListener('change', async (event) => {
  const box = event.target.closest('input[type="checkbox"]');
  if (!box) return;
  await chrome.storage.local.set({
    declutter: { ...(await readDeclutter()), [box.dataset.id]: box.checked }
  });
});

readDeclutter().then(renderToggles);
