const site = new URLSearchParams(location.search).get('site');
const note = document.getElementById('note');
const line = document.getElementById('line');

if (site) document.getElementById('site').textContent = site;

function format(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = hours ? [hours, mins, secs] : [mins, secs];
  return parts.map((part, i) => (i ? String(part).padStart(2, '0') : part)).join(':');
}

function coarse(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(mins / 60);
  if (!hours) return `${mins} min`;
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

// The reason comes from the live state, not the URL — a spent limit outranks a
// session, because it is the one that cannot be called off.
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  const entry = state.entries.find(({ domain }) => domain === site);

  if (entry?.why === 'limit') {
    const budget = state.limits[entry.site] ?? 0;
    note.textContent = `Your ${budget} min a day here is spent.`;
    line.textContent = `Back in ${coarse(state.resetsAt - Date.now())}, at midnight — `
      + 'there is no button for this one.';
    return;
  }
  if (entry?.why === 'session' && state.session) {
    note.textContent = state.session.endsAt === null
      ? 'Focus is on until you turn it off.'
      : `${format(state.session.endsAt - Date.now())} left in this session.`;
    line.textContent = 'Muscle memory brought you here, not a decision.';
    return;
  }
  note.textContent = 'Nothing is blocking this now — reload to continue.';
  line.textContent = '';
}

refresh();
setInterval(refresh, 1000);
