const views = {
  idle: document.getElementById('idle'),
  active: document.getElementById('active')
};
const countdown = document.getElementById('countdown');
const bar = document.getElementById('bar');
const barFill = document.getElementById('bar-fill');
const activeNote = document.getElementById('active-note');
const sessionState = document.getElementById('session-state');
const dot = document.getElementById('dot');
const status = document.getElementById('status');
const sitesBox = document.getElementById('sites');
const count = document.getElementById('count');
const saved = document.getElementById('saved');
const limitsBox = document.getElementById('limits');
const pendingNote = document.getElementById('pending');

let chosenMinutes = 60;

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

// --- Daily limits ----------------------------------------------------------

const rows = new Map(); // site -> { fill, left, input }
let built = '';         // which set of sites the rows were built from
let editing = false;    // a number is half-typed; leave the inputs alone

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

    const edit = document.createElement('span');
    edit.className = 'limit-edit';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '1440';
    input.step = '5';
    input.value = String(limits[site]);
    input.dataset.site = site;
    const drop = document.createElement('button');
    drop.className = 'drop';
    drop.type = 'button';
    drop.dataset.drop = site;
    drop.title = `Stop limiting ${site}`;
    drop.setAttribute('aria-label', `Stop limiting ${site}`);
    drop.textContent = '×';
    edit.append(input, document.createTextNode('min'), drop);
    top.append(name, edit);

    const track = document.createElement('div');
    track.className = 'bar';
    const fill = document.createElement('div');
    track.append(fill);

    const left = document.createElement('p');
    left.className = 'limit-left';

    row.append(top, track, left);
    limitsBox.append(row);
    rows.set(site, { row, fill, left, input });
  }
  built = Object.keys(limits).sort().join(',');
}

function renderLimits(state) {
  const signature = Object.keys(state.limits).sort().join(',');
  if (!editing && signature !== built) buildLimits(state.limits);

  for (const [site, row] of rows) {
    const budget = (state.limits[site] ?? 0) * 60000;
    const spent = state.spent[site] ?? 0;
    const left = budget - spent;
    const out = left <= 0;
    row.row.classList.toggle('out', out);
    row.fill.style.width = `${budget ? Math.min(100, (spent / budget) * 100) : 100}%`;
    row.left.textContent = out
      ? 'Spent — back at midnight'
      : `${format(left)} left today`;
    if (!editing) row.input.value = String(state.limits[site] ?? 0);
  }

  if (!state.pending) {
    pendingNote.hidden = true;
    return;
  }
  const changes = [...new Set([...Object.keys(state.limits), ...Object.keys(state.pending)])]
    .sort()
    .filter((site) => state.pending[site] !== state.limits[site])
    .map((site) => (site in state.pending ? `${site} ${state.pending[site]} min` : `${site} off`));
  pendingNote.hidden = !changes.length;
  pendingNote.textContent = `From tomorrow: ${changes.join(', ')}.`;
}

async function saveLimits(limits) {
  editing = false;
  built = ''; // rebuild from whatever the background decided to allow
  apply(await send({ type: 'setLimits', limits }));
}

function collectLimits(extra) {
  const limits = { ...extra };
  for (const [site, row] of rows) {
    const minutes = Number(row.input.value);
    if (site in limits) continue;
    if (Number.isFinite(minutes) && minutes >= 0) limits[site] = Math.round(minutes);
  }
  return limits;
}

limitsBox.addEventListener('input', () => { editing = true; });

limitsBox.addEventListener('change', (event) => {
  if (event.target.matches('input[type="number"]')) saveLimits(collectLimits());
});

limitsBox.addEventListener('click', (event) => {
  const site = event.target.closest('[data-drop]')?.dataset.drop;
  if (!site) return;
  const limits = collectLimits();
  delete limits[site];
  saveLimits(limits);
});

document.getElementById('add-limit').addEventListener('click', () => {
  const siteBox = document.getElementById('new-site');
  const minutesBox = document.getElementById('new-minutes');
  const site = siteBox.value.trim();
  const minutes = Number(minutesBox.value);
  if (!site || !Number.isFinite(minutes) || minutes < 0) return;
  saveLimits(collectLimits({ [site]: Math.round(minutes) }));
  siteBox.value = '';
  minutesBox.value = '';
});

// --- Session ---------------------------------------------------------------

function renderSession(session, anyBlocked) {
  const active = Boolean(session);
  views.idle.hidden = active;
  views.active.hidden = !active;
  sessionState.textContent = active ? 'on' : 'off';
  dot.classList.toggle('on', active || anyBlocked);
  status.classList.toggle('on', active || anyBlocked);
  status.textContent = active || anyBlocked ? 'Blocking' : 'Not blocking';
  if (!active) return;

  if (session.endsAt === null) {
    countdown.textContent = 'On';
    activeNote.textContent = 'No timer — running until you stop it.';
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const span = session.endsAt - session.startedAt;
  const left = session.endsAt - Date.now();
  countdown.textContent = format(left);
  activeNote.textContent = 'left in this session';
  barFill.style.width = `${(1 - left / span) * 100}%`;
}

function renderSites(sites) {
  if (document.activeElement !== sitesBox) sitesBox.value = sites.join('\n');
  count.textContent = String(sites.length);
}

function apply(state) {
  renderSession(state.session, state.blocked.length > 0);
  renderSites(state.sites);
  renderLimits(state);
}

async function refresh() {
  apply(await send({ type: 'getState' }));
}

document.getElementById('durations').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  chosenMinutes = Number(chip.dataset.minutes);
  for (const other of document.querySelectorAll('.chip')) {
    other.setAttribute('aria-pressed', String(other === chip));
  }
});

document.getElementById('start').addEventListener('click', async () => {
  apply(await send({ type: 'start', minutes: chosenMinutes || null }));
});

document.getElementById('stop').addEventListener('click', async () => {
  apply(await send({ type: 'stop' }));
});

document.getElementById('save').addEventListener('click', async () => {
  apply(await send({ type: 'setSites', sites: sitesBox.value.split('\n') }));
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 1500);
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.minutes) === chosenMinutes));
}

refresh();
// The minutes tick down while the popup is open, so keep asking.
setInterval(refresh, 1000);

// --- Declutter toggles -----------------------------------------------------

const togglesBox = document.getElementById('toggles');
const hiddenCount = document.getElementById('hidden-count');

function renderToggles(enabled) {
  togglesBox.replaceChildren();
  for (const site of Object.values(DECLUTTER_RULES)) {
    const heading = document.createElement('p');
    heading.className = 'site-name';
    heading.textContent = site.label;
    togglesBox.append(heading);

    for (const rule of site.rules) {
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
  hiddenCount.textContent = String(Object.values(enabled).filter(Boolean).length);
}

async function readDeclutter() {
  const { declutter } = await chrome.storage.local.get('declutter');
  return { ...defaultDeclutter(), ...declutter };
}

togglesBox.addEventListener('change', async (event) => {
  const box = event.target.closest('input[type="checkbox"]');
  if (!box) return;
  const enabled = { ...(await readDeclutter()), [box.dataset.id]: box.checked };
  await chrome.storage.local.set({ declutter: enabled });
  hiddenCount.textContent = String(Object.values(enabled).filter(Boolean).length);
});

readDeclutter().then(renderToggles);
