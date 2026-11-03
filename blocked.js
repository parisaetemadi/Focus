const site = new URLSearchParams(location.search).get('site');
const note = document.getElementById('note');
const line = document.getElementById('line');

if (site) document.getElementById('site').textContent = site;

function coarse(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(mins / 60);
  if (!hours) return `${mins} min`;
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

// The reason comes from the live state, not the URL — a spent limit outranks
// Focus now, because it is the one that cannot be called off.
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
  if (entry?.why === 'focus') {
    note.textContent = 'Focus now is on.';
    line.textContent = 'It stays on until you stop it in the popup.';
    return;
  }
  note.textContent = 'Nothing is blocking this now — reload to continue.';
  line.textContent = '';
}

refresh();
setInterval(refresh, 1000);
