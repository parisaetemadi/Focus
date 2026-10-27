const site = new URLSearchParams(location.search).get('site');
const note = document.getElementById('note');

if (site) document.getElementById('site').textContent = site;

function format(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = hours ? [hours, mins, secs] : [mins, secs];
  return parts.map((part, i) => (i ? String(part).padStart(2, '0') : part)).join(':');
}

async function refresh() {
  const { session } = await chrome.runtime.sendMessage({ type: 'getState' });
  if (!session) {
    note.textContent = 'The session is over — reload to continue.';
    return;
  }
  if (session.endsAt === null) {
    note.textContent = 'Focus is on until you turn it off.';
    return;
  }
  note.textContent = `${format(session.endsAt - Date.now())} left in this session.`;
}

refresh();
setInterval(refresh, 1000);
