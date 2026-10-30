// Cửa sổ chính (trang chủ): nút chụp + cài đặt phím tắt. Chỉnh sửa ảnh diễn ra ngay trên overlay.
const api = window.api;
const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

const showKey = (hk) => hk.replace(/\bSuper\b/g, 'Win');

async function refreshHotkeyLabel() {
  const hk = showKey(await api.getHotkey());
  $('hotkey-label').textContent = hk;
  $('hotkey-input').value = hk;
}

// Ghi phím tắt: bấm thử tổ hợp trong ô. Tổ hợp mà Windows giữ riêng (ví dụ Win+Shift+S) không tới được đây.
function comboFromEvent(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  let key = e.code;
  if (key.startsWith('Key')) key = key.slice(3);
  else if (key.startsWith('Digit')) key = key.slice(5);
  else if (key.startsWith('Arrow')) key = key.slice(5);
  else if (key === 'Escape') key = 'Esc';
  const standalone = /^(F\d{1,2}|PrintScreen|Pause|ScrollLock)$/.test(key);
  if (!mods.length && !standalone) return { error: 'Cần kèm Ctrl / Alt / Shift / Win (hoặc dùng phím F1–F24, PrintScreen).' };
  return { combo: [...mods, key].join('+') };
}

$('hotkey-input').addEventListener('keydown', async (e) => {
  e.preventDefault();
  const r = comboFromEvent(e);
  if (!r) return;
  if (r.error) {
    $('hotkey-error').textContent = r.error;
    return;
  }
  await chooseHotkey(r.combo);
});

// ---------- Dùng Win+Shift+S (tắt Snipping Tool của Windows) ----------
function renderSnip(disabled) {
  $('snip-status').textContent = disabled
    ? 'Snipping Tool đang tắt: SnapNote dùng được Win+Shift+S.'
    : 'Snipping Tool của Windows đang giữ Win+Shift+S.';
  $('btn-snip').textContent = disabled ? 'Bật lại Snipping Tool' : 'Dùng Win+Shift+S cho SnapNote';
}

async function refreshSnip() {
  renderSnip((await api.snipStatus()).disabled);
}

$('btn-snip').addEventListener('click', async () => {
  const btn = $('btn-snip');
  btn.disabled = true;
  $('snip-error').textContent = '';
  try {
    const r = await api.snipToggle();
    if (r.error) $('snip-error').textContent = r.error;
    else if (r.changed) toast(r.disabled ? 'Đã tắt Snipping Tool, Win+Shift+S dùng cho SnapNote' : 'Đã bật lại Snipping Tool');
  } catch (ex) {
    $('snip-error').textContent = String(ex.message ?? ex).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    btn.disabled = false;
    await refreshSnip();
    refreshHotkeyLabel();
  }
});

// ---------- Khởi chạy cùng Windows & cập nhật ----------
let version = '';
let updateAction = null;

function renderUpdate(s) {
  const text = $('update-text');
  const btn = $('btn-update');
  const bar = $('update-progress');
  text.className = '';
  bar.hidden = s.state !== 'downloading';
  btn.disabled = false;
  btn.hidden = false;
  switch (s.state) {
    case 'dev':
      text.textContent = `Phiên bản ${version} · chỉ kiểm tra được ở bản đã cài đặt`;
      btn.hidden = true;
      updateAction = null;
      break;
    case 'checking':
      text.textContent = 'Đang kiểm tra…';
      btn.textContent = 'Kiểm tra ngay';
      btn.disabled = true;
      break;
    case 'none':
      text.textContent = `Bạn đang dùng bản mới nhất (v${version})`;
      btn.textContent = 'Kiểm tra lại';
      updateAction = api.checkUpdate;
      break;
    case 'available':
      text.textContent = `Có bản mới v${s.version}`;
      btn.textContent = 'Tải về';
      updateAction = api.downloadUpdate;
      break;
    case 'downloading':
      text.textContent = `Đang tải… ${s.percent ?? 0}%`;
      bar.firstElementChild.style.width = (s.percent ?? 0) + '%';
      btn.textContent = 'Đang tải';
      btn.disabled = true;
      break;
    case 'ready':
      text.textContent = `Đã tải xong v${s.version}`;
      btn.textContent = 'Khởi động lại để cập nhật';
      updateAction = api.installUpdate;
      break;
    case 'error':
      text.textContent = s.message;
      text.className = 'err';
      btn.textContent = 'Thử lại';
      updateAction = api.checkUpdate;
      break;
    default:
      text.textContent = `Phiên bản ${version}`;
      btn.textContent = 'Kiểm tra ngay';
      updateAction = api.checkUpdate;
  }
}

async function loadSettings() {
  const s = await api.getSettings();
  version = s.version;
  $('opt-startup').checked = s.launchAtStartup;
  $('opt-autoupdate').checked = s.autoCheckUpdates;
  $('startup-note').hidden = s.packaged;
  renderRecordConfig(s);
  refreshSnip();
  renderUpdate(s.update);
}

$('opt-startup').addEventListener('change', (e) => api.setSetting('launchAtStartup', e.target.checked));
$('opt-autoupdate').addEventListener('change', (e) => api.setSetting('autoCheckUpdates', e.target.checked));
$('btn-update').addEventListener('click', () => updateAction?.());
api.onUpdateStatus(renderUpdate);

async function chooseHotkey(combo) {
  const err = $('hotkey-error');
  try {
    await api.setHotkey(combo);
    err.textContent = '';
    await refreshHotkeyLabel();
    toast('Đã đổi phím tắt thành ' + showKey(combo));
  } catch (ex) {
    err.textContent = String(ex.message ?? ex).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
}
document.querySelectorAll('.presets button').forEach((b) => b.addEventListener('click', () => chooseHotkey(b.dataset.hotkey)));

// ---------- Ghi âm ----------
let recClock = null;
function renderRec(s) {
  clearInterval(recClock);
  const btn = $('btn-rec');
  const label = $('rec-label');
  btn.classList.toggle('recording', s.recording);
  if (!s.recording) {
    label.textContent = 'Ghi âm';
    return;
  }
  const tick = () => {
    const ms = s.elapsedMs + (s.resumedAt ? Date.now() - s.resumedAt : 0);
    const sec = Math.max(0, Math.floor(ms / 1000));
    const p = (n) => String(n).padStart(2, '0');
    label.textContent = `Dừng và lưu  ${p(Math.floor(sec / 60))}:${p(sec % 60)}${s.paused ? ' (tạm dừng)' : ''}`;
  };
  tick();
  recClock = setInterval(tick, 1000);
}
$('btn-rec').addEventListener('click', () => api.recToggle());
$('btn-open-rec').addEventListener('click', () => api.recOpenFolder());
api.onRecState(renderRec);
api.recInfo().then(renderRec);

// Nơi lưu bản ghi: thư mục mặc định (sửa được) hoặc hỏi mỗi lần ghi xong.
function renderRecordConfig(s) {
  document.querySelectorAll('input[name="rec-mode"]').forEach((r) => (r.checked = r.value === s.recordSaveMode));
  $('rec-dir').value = s.recordDir;
  $('rec-dir-row').classList.toggle('off', s.recordSaveMode === 'ask');
}

async function saveRecordConfig(cfg) {
  const err = $('rec-error');
  try {
    const r = await api.recSetConfig(cfg);
    err.textContent = '';
    return r;
  } catch (ex) {
    err.textContent = String(ex.message ?? ex).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    return null;
  } finally {
    renderRecordConfig(await api.getSettings());
  }
}

document.querySelectorAll('input[name="rec-mode"]').forEach((r) => r.addEventListener('change', () => saveRecordConfig({ mode: r.value })));
$('rec-dir').addEventListener('change', (e) => saveRecordConfig({ dir: e.target.value }));
$('btn-rec-dir').addEventListener('click', async () => {
  const dir = await api.recChooseDir();
  if (dir) saveRecordConfig({ dir });
});
$('btn-rec-reset').addEventListener('click', () => saveRecordConfig({ dir: '' }));

$('btn-new').addEventListener('click', () => api.startCapture());
// ---------- Chuyển giữa trang chủ và trang cài đặt ----------
function showView(name) {
  const settings = name === 'settings';
  $('view-settings').hidden = !settings;
  $('view-home').hidden = settings;
  $('btn-back').hidden = !settings;
  $('btn-settings').hidden = settings;
  $('page-title').textContent = settings ? 'Cài đặt' : 'SnapNote';
}

$('btn-back').addEventListener('click', () => showView('home'));
$('btn-settings').addEventListener('click', async () => {
  $('hotkey-error').textContent = '';
  await loadSettings();
  showView('settings');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('view-settings').hidden && document.activeElement !== $('hotkey-input')) showView('home');
});

refreshHotkeyLabel();
loadSettings();
