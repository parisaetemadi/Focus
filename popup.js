// The popup is one screen: what is left of each app's day, and Focus now.
// The apps and their minutes are written as text under More — that list is
// the only place they are edited, and it saves itself.

const dot = document.getElementById('dot');
const status = document.getElementById('status');
const stale = document.getElementById('stale');
const empty = document.getElementById('empty');
const limitsBox = document.getElementById('limits');
const focusButton = document.getElementById('focus');
const durations = document.getElementById('durations');
const planBox = document.getElementById('plan');
const pendingNote = document.getElementById('pending');

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

    const drop = document.createElement('button');
    drop.className = 'drop';
    drop.dataset.site = site;
    drop.title = `Take ${site} off the list`;
    drop.setAttribute('aria-label', `Take ${site} off the list`);
    drop.innerHTML = '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">'
      + '<path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" stroke-width="1.5" '
      + 'stroke-linecap="round"/></svg>';

    top.append(name, left, drop);

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

limitsBox.addEventListener('click', async (event) => {
  const drop = event.target.closest('button.drop');
  if (drop) apply(await send({ type: 'dropToday', site: drop.dataset.site }));
});

// --- Focus -----------------------------------------------------------------

let chosenMinutes = 60;

durations.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  chosenMinutes = Number(chip.dataset.minutes);
  paintChips();
});

function paintChips() {
  for (const chip of durations.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.minutes) === chosenMinutes));
  }
}

focusButton.addEventListener('click', async () => {
  apply(await send({
    type: 'setFocus',
    on: !focusOn,
    minutes: focusOn ? null : chosenMinutes || null
  }));
});

let focusOn = false;
let lastLimits = {};

function apply(state) {
  focusOn = Boolean(state.focus);
  // What you wrote, not what survived into today: a line you deleted or
  // raised lives in `pending` until midnight, and the box must keep showing
  // your version or the edit looks like it was thrown away.
  const written = state.pending ?? state.limits;
  lastLimits = written;
  empty.hidden = Object.keys(state.limits).length > 0;

  const spent = Object.keys(state.limits).filter((site) => state.blocked.includes(site)).length;
  const on = focusOn || spent > 0;
  dot.classList.toggle('on', on);
  status.classList.toggle('on', on);
  if (focusOn) {
    const left = state.focus.endsAt && state.focus.endsAt - Date.now();
    status.textContent = left ? `Focus · ${format(left)}` : 'Focus on';
  } else if (spent) {
    status.textContent = spent === 1 ? '1 app spent' : `${spent} apps spent`;
  } else {
    status.textContent = 'Nothing spent yet';
  }

  // Nothing to pick while a session is running; the clock is in the header.
  durations.hidden = focusOn;
  focusButton.textContent = focusOn ? 'Stop focus' : 'Focus now';
  focusButton.classList.toggle('stopping', focusOn);

  renderLimits(state);
  // Don't yank the list out from under the cursor mid-edit.
  if (document.activeElement !== planBox) planBox.value = planText(written);
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

paintChips();
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
