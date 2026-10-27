const api = window.api;
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

const PAUSE = '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>';

let info = await api.recInfo();

// Thời gian đã ghi, không tính lúc tạm dừng.
function elapsed() {
  return info.elapsedMs + (info.resumedAt ? Date.now() - info.resumedAt : 0);
}

function tick() {
  const sec = Math.max(0, Math.floor(elapsed() / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  $('time').textContent = (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(sec % 60);
}

function render() {
  $('dot').classList.toggle('paused', info.paused);
  $('time').classList.toggle('paused', info.paused);
  $('toggle').innerHTML = info.paused ? PLAY : PAUSE;
  $('toggle').title = info.paused ? 'Tiếp tục ghi âm' : 'Tạm dừng';
  tick();
}

api.onRecState((s) => {
  info = s;
  render();
});
$('toggle').addEventListener('click', () => (info.paused ? api.recResume() : api.recPause()));
$('stop').addEventListener('click', () => api.recStop());

render();
setInterval(tick, 500);
