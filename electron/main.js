import {
  app, BrowserWindow, ClipboardItem, Menu, Tray, clipboard, desktopCapturer, dialog,
  globalShortcut, ipcMain, nativeImage, screen,
} from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as settings from './settings.js';
import * as updates from './updates.js';
import * as hotkeys from './hotkey.js';
import * as recorder from './recorder.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = path.join(root, 'electron', 'preload.cjs');
const DEFAULT_HOTKEY = 'Ctrl+Shift+A';
const startHidden = process.argv.includes('--hidden'); // khởi chạy cùng Windows: chỉ nằm ở khay

let editor = null;
let tray = null;
let quitting = false;
let hotkey = DEFAULT_HOTKEY;

// ---------- Cài đặt ----------
async function loadSettings() {
  await settings.load();
  hotkey = settings.get('hotkey') || DEFAULT_HOTKEY;
}

const saveSettings = () => settings.set('hotkey', hotkey).catch(() => {});

// Chỉ đăng ký khi đã đóng gói; ở chế độ dev sẽ trỏ nhầm vào electron.exe.
function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.get('launchAtStartup'), args: ['--hidden'] });
}

const registerHotkey = (acc) => hotkeys.apply(acc, beginCapture);

// ---------- Khay hệ thống ----------
const trayIcon = () => nativeImage.createFromPath(path.join(root, 'assets', 'tray.png'));
const trayRecIcon = () => nativeImage.createFromPath(path.join(root, 'assets', 'tray-rec.png'));
let trayTimer = null;

/** Thời gian đã ghi (không tính lúc tạm dừng). */
const elapsed = (s) => s.elapsedMs + (s.resumedAt ? Date.now() - s.resumedAt : 0);

const clock = (ms) => {
  const sec = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 60))}:${p(sec % 60)}`;
};

function refreshTray() {
  if (!tray) return;
  const s = recorder.getState();
  tray.setImage(s.recording ? trayRecIcon() : trayIcon());
  tray.setToolTip(s.recording ? `SnapNote · ${s.paused ? 'Tạm dừng' : 'Đang ghi âm'} ${clock(elapsed(s))}` : 'SnapNote');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Chụp màn hình', click: beginCapture },
    ...(s.recording
      ? [
        s.paused
          ? { label: 'Tiếp tục ghi âm', click: () => recorder.resume() }
          : { label: 'Tạm dừng ghi âm', click: () => recorder.pause() },
        { label: 'Dừng và lưu ghi âm', click: () => recorder.stop() },
      ]
      : [{ label: 'Ghi âm', click: () => recorder.start() }]),
    { label: 'Mở trình chỉnh sửa', click: showEditor },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
}

function onRecState(s) {
  clearInterval(trayTimer);
  if (s.recording) trayTimer = setInterval(refreshTray, 1000);
  refreshTray();
  editor?.webContents.send('rec-state', s);
}

// ---------- Cửa sổ editor ----------
function createEditor() {
  editor = new BrowserWindow({
    width: 560, height: 700, minWidth: 460, minHeight: 640,
    show: false, backgroundColor: '#16171d', title: 'SnapNote',
    icon: path.join(root, 'assets', 'icon.png'),
    webPreferences: { preload },
  });
  editor.loadFile(path.join(root, 'dist', 'index.html'));
  if (!app.isPackaged) {
    editor.webContents.on('console-message', (e) => console.log(`[editor:${e.level}] ${e.message}`));
  }
  editor.once('ready-to-show', () => !startHidden && editor.show());
  // Đóng cửa sổ chỉ ẩn xuống khay, không thoát app.
  editor.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      editor.hide();
    }
  });
}

function showEditor() {
  if (!editor) return createEditor();
  if (editor.isMinimized()) editor.restore();
  editor.show();
  editor.focus();
}

// ---------- Chụp màn hình ----------
// Mỗi màn hình có sẵn một cửa sổ overlay ẩn (đã nạp trang) nên bấm phím tắt là hiện gần như ngay:
// chỉ còn chụp -> gửi ảnh thô -> hiện, không phải tạo cửa sổ hay mã hoá/giải mã PNG.
const dbg = (...a) => process.env.SNAP_DEBUG && console.log('[snap]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = new Map(); // display.id -> { win, display }
let t0 = 0;
let capturing = false;
let focusWin = null;

function createOverlay(display) {
  const win = new BrowserWindow({
    ...display.bounds, frame: false, show: false, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, enableLargerThanScreen: true,
    backgroundColor: '#000', hasShadow: false,
    webPreferences: { preload, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(root, 'dist', 'overlay.html'));
  if (process.env.SNAP_DEBUG) win.webContents.on('console-message', (e) => dbg('overlay:', e.message));
  win.on('closed', () => {
    if (pool.get(display.id)?.win === win) pool.delete(display.id);
  });
  pool.set(display.id, { win, display });
}

/** Giữ đúng một overlay cho mỗi màn hình hiện có (gọi khi khởi động và khi cắm/rút màn hình). */
function syncOverlayPool() {
  const displays = screen.getAllDisplays();
  const ids = new Set(displays.map((d) => d.id));
  for (const [id, entry] of [...pool]) if (!ids.has(id)) entry.win.destroy();
  for (const d of displays) {
    const entry = pool.get(d.id);
    if (!entry) createOverlay(d);
    else {
      entry.display = d;
      if (!entry.win.isVisible()) entry.win.setBounds(d.bounds);
    }
  }
}

function closeOverlays() {
  for (const { win } of pool.values()) {
    if (win.isDestroyed() || !win.isVisible()) continue;
    win.hide();
    win.webContents.send('overlay-reset');
  }
}

const loaded = (win) =>
  win.webContents.isLoading() ? new Promise((r) => win.webContents.once('did-finish-load', r)) : Promise.resolve();

async function beginCapture() {
  if (capturing) return;
  capturing = true;
  t0 = Date.now();
  try {
    const hadOverlay = [...pool.values()].some((e) => e.win.isVisible());
    closeOverlays();
    const hadEditor = !!editor?.isVisible();
    if (hadEditor) editor.hide();
    // Chờ cửa sổ vừa ẩn biến mất khỏi khung hình rồi mới chụp.
    if (hadOverlay || hadEditor) await sleep(150);

    syncOverlayPool();
    const displays = screen.getAllDisplays();
    const size = displays.reduce(
      (m, d) => ({
        width: Math.max(m.width, Math.round(d.size.width * d.scaleFactor)),
        height: Math.max(m.height, Math.round(d.size.height * d.scaleFactor)),
      }),
      { width: 1, height: 1 },
    );
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    dbg('getSources done', Date.now() - t0, 'ms');
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    focusWin = null;

    for (const [i, d] of displays.entries()) {
      const entry = pool.get(d.id);
      const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[i];
      if (!entry || !src) continue;
      let image = src.thumbnail;
      const pw = Math.round(d.size.width * d.scaleFactor);
      const ph = Math.round(d.size.height * d.scaleFactor);
      const cur = image.getSize();
      if (cur.width !== pw || cur.height !== ph) image = image.resize({ width: pw, height: ph, quality: 'best' });
      const { width, height } = image.getSize();
      await loaded(entry.win);
      entry.win.webContents.send('overlay-capture', { width, height, bitmap: image.toBitmap() }); // BGRA
      if (d.id === cursor.id) focusWin = entry.win;
    }
  } catch (e) {
    console.error('Chụp thất bại:', e);
    closeOverlays();
  } finally {
    capturing = false;
  }
}

ipcMain.handle('start-capture', () => beginCapture());

// Overlay vẽ xong ảnh thì mới hiện, tránh nháy khung đen/ảnh cũ.
ipcMain.handle('overlay-drawn', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const entry = [...pool.values()].find((x) => x.win === win);
  if (!entry) return;
  win.setBounds(entry.display.bounds); // đặt lại để tránh lệch khi màn hình khác DPI
  win.show();
  if (win === focusWin) win.focus();
  dbg('overlay shown', Date.now() - t0, 'ms');
});

ipcMain.handle('cancel-selection', () => closeOverlays());

// ---------- Cửa sổ chỉnh sửa đầy đủ (mở từ nút "Chỉnh sửa" trên overlay) ----------
const editPayloads = new Map(); // webContents.id -> { image, annotations }

ipcMain.handle('open-editor', (_e, payload) => {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 720, minHeight: 480,
    backgroundColor: '#16171d', title: 'SnapNote - Chỉnh sửa', autoHideMenuBar: true,
    icon: path.join(root, 'assets', 'icon.png'),
    webPreferences: { preload },
  });
  const id = win.webContents.id;
  editPayloads.set(id, payload);
  win.on('closed', () => editPayloads.delete(id));
  win.loadFile(path.join(root, 'dist', 'edit.html'));
  closeOverlays();
});

ipcMain.handle('get-edit-payload', (e) => editPayloads.get(e.sender.id) ?? null);

ipcMain.handle('save-image', async (e, bytes, name) => {
  // Hộp thoại gắn vào overlay để luôn nổi phía trên lớp phủ toàn màn hình.
  const parent = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    defaultPath: path.join(app.getPath('pictures'), name),
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, Buffer.from(bytes));
  return filePath;
});

// Electron mới: clipboard.write là async và nhận mảng ClipboardItem (không còn writeImage).
ipcMain.handle('copy-image', async (_e, bytes) => {
  const blob = new Blob([Buffer.from(bytes)], { type: 'image/png' });
  await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
});

ipcMain.handle('get-hotkey', () => hotkey);

ipcMain.handle('record-hotkey', async () => {
  try {
    return await hotkeys.recordCombo();
  } finally {
    registerHotkey(hotkey); // bật lại phím tắt hiện tại; nếu có tổ hợp mới thì giao diện sẽ gọi set-hotkey ngay sau đó
  }
});
ipcMain.handle('cancel-record-hotkey', () => hotkeys.cancelRecord());

ipcMain.handle('get-settings', () => ({
  ...settings.all(),
  version: app.getVersion(),
  packaged: app.isPackaged,
  update: updates.getStatus(),
}));

ipcMain.handle('set-setting', async (_e, key, value) => {
  if (!['launchAtStartup', 'autoCheckUpdates'].includes(key) || typeof value !== 'boolean') return;
  await settings.set(key, value);
  if (key === 'launchAtStartup') applyLoginItem();
  if (key === 'autoCheckUpdates') updates.applySchedule();
});

ipcMain.handle('check-update', () => updates.check(true));
ipcMain.handle('download-update', () => updates.download());
ipcMain.handle('install-update', () => { quitting = true; updates.install(); });

ipcMain.handle('set-hotkey', async (_e, next) => {
  const prev = hotkey;
  if (!registerHotkey(next)) {
    registerHotkey(prev);
    throw new Error('Không đăng ký được phím tắt này (không hợp lệ hoặc đã bị app khác chiếm).');
  }
  hotkey = next;
  await saveSettings();
});

// ---------- Khởi động ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showEditor);

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await loadSettings();
    recorder.init({ preload, root, onChange: onRecState });
    applyLoginItem(); // đồng bộ lại đường dẫn sau mỗi lần cập nhật
    updates.init((s) => editor?.webContents.send('update-status', s), showEditor);
    if (!registerHotkey(hotkey)) {
      hotkey = DEFAULT_HOTKEY;
      registerHotkey(hotkey);
    }

    tray = new Tray(trayIcon());
    refreshTray();
    tray.on('click', beginCapture);

    createEditor();

    syncOverlayPool();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, syncOverlayPool);
  });

  // Đang ghi âm mà thoát app thì dừng và lưu file trước, tránh mất bản ghi.
  let quitStopping = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (recorder.isRecording() && !quitStopping) {
      e.preventDefault();
      quitStopping = true;
      recorder.stop().finally(() => app.quit());
    }
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    hotkeys.dispose();
  });
  app.on('window-all-closed', () => {}); // giữ app chạy nền trong khay
}
