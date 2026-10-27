import {
  app, BrowserWindow, ClipboardItem, Menu, Tray, clipboard, desktopCapturer, dialog,
  globalShortcut, ipcMain, nativeImage, screen,
} from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as settings from './settings.js';
import * as updates from './updates.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = path.join(root, 'electron', 'preload.cjs');
const DEFAULT_HOTKEY = 'Ctrl+Shift+A';
const startHidden = process.argv.includes('--hidden'); // khởi chạy cùng Windows: chỉ nằm ở khay

let editor = null;
let tray = null;
let quitting = false;
let hotkey = DEFAULT_HOTKEY;
const overlays = new Map(); // webContents.id -> { win, image: NativeImage }

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

function registerHotkey(acc) {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(acc, beginCapture);
  } catch {
    return false;
  }
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
function closeOverlays() {
  for (const { win } of overlays.values()) if (!win.isDestroyed()) win.destroy();
  overlays.clear();
}

let capturing = false;
async function beginCapture() {
  if (capturing) return;
  capturing = true;
  try {
    const hadOverlay = overlays.size > 0;
    closeOverlays();
    const hadEditor = !!editor?.isVisible();
    if (hadEditor) editor.hide();
    // Chờ cửa sổ (overlay cũ / cửa sổ chính) biến mất khỏi khung hình rồi mới chụp.
    if (hadOverlay || hadEditor) await new Promise((r) => setTimeout(r, 220));
    const displays = screen.getAllDisplays();
    const size = displays.reduce(
      (m, d) => ({
        width: Math.max(m.width, Math.round(d.size.width * d.scaleFactor)),
        height: Math.max(m.height, Math.round(d.size.height * d.scaleFactor)),
      }),
      { width: 1, height: 1 },
    );
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let focusWin = null;

    for (const [i, d] of displays.entries()) {
      const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[i];
      if (!src) continue;
      let image = src.thumbnail;
      const pw = Math.round(d.size.width * d.scaleFactor);
      const ph = Math.round(d.size.height * d.scaleFactor);
      const cur = image.getSize();
      if (cur.width !== pw || cur.height !== ph) image = image.resize({ width: pw, height: ph, quality: 'best' });

      const win = new BrowserWindow({
        ...d.bounds, frame: false, show: false, resizable: false, movable: false,
        skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, enableLargerThanScreen: true,
        backgroundColor: '#000', hasShadow: false,
        webPreferences: { preload },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      overlays.set(win.webContents.id, { win, image });
      win.loadFile(path.join(root, 'dist', 'overlay.html'));
      win.once('ready-to-show', () => {
        win.setBounds(d.bounds); // đặt lại để tránh lệch khi màn hình khác DPI
        win.show();
        if (d.id === cursor.id) win.focus();
      });
      if (d.id === cursor.id) focusWin = win;
    }
    focusWin?.focus();
  } catch (e) {
    console.error('Chụp thất bại:', e);
    closeOverlays();
  } finally {
    capturing = false;
  }
}

ipcMain.handle('start-capture', () => beginCapture());

ipcMain.handle('get-capture-image', (e) => overlays.get(e.sender.id)?.image.toPNG());

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
    applyLoginItem(); // đồng bộ lại đường dẫn sau mỗi lần cập nhật
    updates.init((s) => editor?.webContents.send('update-status', s), showEditor);
    if (!registerHotkey(hotkey)) {
      hotkey = DEFAULT_HOTKEY;
      registerHotkey(hotkey);
    }

    tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets', 'tray.png')));
    tray.setToolTip('SnapNote');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Chụp màn hình', click: beginCapture },
      { label: 'Mở trình chỉnh sửa', click: showEditor },
      { type: 'separator' },
      { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', beginCapture);

    createEditor();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {}); // giữ app chạy nền trong khay
}
