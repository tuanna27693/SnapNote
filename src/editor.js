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

// Ghi phím tắt ở mức hệ thống (trình phụ keyhook) vì Windows nuốt các tổ hợp có phím Win
// nên trang web không nhận được; ghi bằng hook thì bấm Win+bất kỳ phím nào cũng nhận.
let recording = false;
async function recordHotkey() {
  if (recording) return;
  recording = true;
  const input = $('hotkey-input');
  input.classList.add('recording');
  input.value = 'Nhấn tổ hợp phím… (Esc để hủy)';
  $('hotkey-error').textContent = '';
  try {
    const combo = await api.recordHotkey();
    if (combo) await chooseHotkey(combo);
  } catch (ex) {
    $('hotkey-error').textContent = String(ex.message ?? ex).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    recording = false;
    input.classList.remove('recording');
    refreshHotkeyLabel();
  }
}
$('hotkey-input').addEventListener('click', recordHotkey);
$('settings').addEventListener('close', () => api.cancelRecordHotkey());

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
  renderUpdate(s.update);
}

$('opt-startup').addEventListener('change', (e) => api.setSetting('launchAtStartup', e.target.checked));
$('opt-autoupdate').addEventListener('change', (e) => api.setSetting('autoCheckUpdates', e.target.checked));
$('btn-update').addEventListener('click', () => updateAction?.());
$('btn-close-settings').addEventListener('click', () => $('settings').close());
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

$('btn-new').addEventListener('click', () => api.startCapture());
$('btn-settings').addEventListener('click', async () => {
  $('hotkey-error').textContent = '';
  await loadSettings();
  $('settings').showModal();
});

refreshHotkeyLabel();
loadSettings();
