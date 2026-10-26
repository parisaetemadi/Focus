const views = {
  idle: document.getElementById('idle'),
  active: document.getElementById('active')
};
const countdown = document.getElementById('countdown');
const bar = document.getElementById('bar');
const barFill = document.getElementById('bar-fill');
const activeNote = document.getElementById('active-note');
const dot = document.getElementById('dot');
const status = document.getElementById('status');
const sitesBox = document.getElementById('sites');
const count = document.getElementById('count');
const saved = document.getElementById('saved');

let chosenMinutes = 60;
let ticker = null;

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

function render(session) {
  clearInterval(ticker);
  const active = Boolean(session);
  views.idle.hidden = active;
  views.active.hidden = !active;
  dot.classList.toggle('on', active);
  status.classList.toggle('on', active);
  status.textContent = active ? 'Blocking' : 'Not blocking';
  if (!active) return;

  if (session.endsAt === null) {
    countdown.textContent = 'On';
    activeNote.textContent = 'No timer — running until you stop it.';
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  const span = session.endsAt - session.startedAt;
  const tick = () => {
    const left = session.endsAt - Date.now();
    if (left <= 0) {
      refresh();
      return;
    }
    countdown.textContent = format(left);
    barFill.style.width = `${(1 - left / span) * 100}%`;
  };
  activeNote.textContent = 'left in this session';
  tick();
  ticker = setInterval(tick, 1000);
}

function renderSites(sites) {
  sitesBox.value = sites.join('\n');
  count.textContent = String(sites.length);
}

async function refresh() {
  const { session, sites } = await send({ type: 'getState' });
  render(session);
  renderSites(sites);
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
  const { session } = await send({ type: 'start', minutes: chosenMinutes || null });
  render(session);
});

document.getElementById('stop').addEventListener('click', async () => {
  await send({ type: 'stop' });
  render(null);
});

document.getElementById('save').addEventListener('click', async () => {
  const { sites } = await send({ type: 'setSites', sites: sitesBox.value.split('\n') });
  renderSites(sites);
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 1500);
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.minutes) === chosenMinutes));
}

refresh();

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
