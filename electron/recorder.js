import { BrowserWindow, Notification, app, desktopCapturer, dialog, ipcMain, screen, session, shell } from 'electron';
import { accessSync, constants, createWriteStream, mkdirSync } from 'node:fs';
import { copyFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import * as settings from './settings.js';

// Ghi âm thanh phát ra từ máy (loopback: tiếng người bên kia trong mọi app gọi) cộng micro, trộn thành một file MP3.
// Việc ghi và mã hoá MP3 chạy trong một cửa sổ ẩn (cần API âm thanh của trình duyệt); main chỉ ghi các mẩu dữ liệu ra đĩa.
let ctx = null; // { preload, root, onChange }
// elapsedMs: thời gian đã ghi tính đến lần bắt đầu/tiếp tục gần nhất; resumedAt = 0 khi đang tạm dừng.
const idle = () => ({ recording: false, paused: false, elapsedMs: 0, resumedAt: 0, file: '', name: '', ask: false, mic: false });
let state = idle();
let recWin = null;
let pillWin = null;
let out = null;
let busy = false;

const pad = (n) => String(n).padStart(2, '0');
export const defaultDir = () => path.join(app.getPath('documents'), 'SnapNote', 'Recordings');
/** Thư mục lưu theo cài đặt (rỗng = mặc định). */
export const recordingsDir = () => settings.get('recordDir') || defaultDir();
/** 'default': lưu thẳng vào thư mục cài đặt; 'ask': ghi tạm rồi hỏi nơi lưu khi dừng. */
const saveMode = () => (settings.get('recordSaveMode') === 'ask' ? 'ask' : 'default');

/** Kiểm tra thư mục có tạo và ghi được không; ném lỗi tiếng Việt nếu không. */
function ensureWritable(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error('Không ghi được vào thư mục này. Hãy chọn thư mục khác.');
  }
}

/** Di chuyển file, kể cả sang ổ đĩa khác. */
async function moveFile(from, to) {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await unlink(from);
  }
}
export const isRecording = () => state.recording;
export const getState = () => ({ ...state });

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

export function init(context) {
  ctx = context;
  // getDisplayMedia trong cửa sổ ghi sẽ nhận ngay âm thanh hệ thống, không hiện hộp chọn màn hình.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_req, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      callback({ video: sources[0], audio: 'loopback' });
    },
    { useSystemPicker: false },
  );

  ipcMain.handle('rec-chunk', (_e, buf) => {
    out?.write(Buffer.from(buf));
  });
  ipcMain.handle('rec-info', () => getState());
  ipcMain.handle('rec-stop', () => stop());
  ipcMain.handle('rec-toggle', () => (state.recording ? stop() : start()));
  ipcMain.handle('rec-pause', () => pause());
  ipcMain.handle('rec-resume', () => resume());
  ipcMain.handle('rec-get-dir', () => recordingsDir());
  ipcMain.handle('rec-choose-dir', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Chọn thư mục lưu bản ghi âm',
      defaultPath: recordingsDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled ? null : filePaths[0];
  });
  ipcMain.handle('rec-set-config', async (_e, cfg) => {
    if (cfg.mode !== undefined) {
      if (!['default', 'ask'].includes(cfg.mode)) throw new Error('Chế độ lưu không hợp lệ.');
      await settings.set('recordSaveMode', cfg.mode);
    }
    if (cfg.dir !== undefined) {
      const dir = String(cfg.dir).trim();
      if (dir) ensureWritable(dir);
      await settings.set('recordDir', dir === defaultDir() ? '' : dir);
    }
    return { mode: saveMode(), dir: recordingsDir() };
  });
  ipcMain.handle('rec-open-folder', () => {
    mkdirSync(recordingsDir(), { recursive: true });
    return shell.openPath(recordingsDir());
  });
}

function openPill() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 270;
  const h = 44;
  pillWin = new BrowserWindow({
    width: w, height: h, x: Math.round(workArea.x + workArea.width / 2 - w / 2), y: workArea.y + 12,
    frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: ctx.preload },
  });
  pillWin.setAlwaysOnTop(true, 'screen-saver');
  pillWin.loadFile(path.join(ctx.root, 'dist', 'pill.html'));
  pillWin.once('ready-to-show', () => pillWin?.showInactive());
}

async function cleanup() {
  for (const w of [recWin, pillWin]) if (w && !w.isDestroyed()) w.destroy();
  recWin = null;
  pillWin = null;
  out = null;
}

export async function start() {
  if (state.recording || busy) return;
  busy = true;
  let file = '';
  let name = '';
  try {
    const ask = saveMode() === 'ask';
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    name = `GhiAm_${stamp}.mp3`;
    // Chế độ hỏi: ghi tạm vào thư mục tạm, hỏi nơi lưu khi dừng. Chế độ mặc định: ghi thẳng vào thư mục đã cấu hình.
    if (ask) {
      file = path.join(app.getPath('temp'), `snapnote-${stamp}.mp3`);
    } else {
      ensureWritable(recordingsDir());
      file = path.join(recordingsDir(), name);
    }
    out = createWriteStream(file);

    recWin = new BrowserWindow({
      show: false, width: 320, height: 200,
      webPreferences: { preload: ctx.preload, backgroundThrottling: false },
    });
    await recWin.loadFile(path.join(ctx.root, 'dist', 'recorder.html'));
    // userGesture = true để getDisplayMedia được phép chạy mà không cần người dùng bấm trong cửa sổ ẩn.
    const res = await recWin.webContents.executeJavaScript('window.__startRec()', true);

    state = { recording: true, paused: false, elapsedMs: 0, resumedAt: Date.now(), file, name, ask, mic: !!res?.mic };
    openPill();
    ctx.onChange(getState());
    if (!state.mic) {
      notify('Không dùng được micro', 'Chỉ ghi âm thanh phát ra từ máy. Kiểm tra quyền micro trong Cài đặt Windows.');
    }
  } catch (e) {
    await cleanup();
    if (file) unlink(file).catch(() => {});
    dialog.showErrorBox('Không bắt đầu được ghi âm', String(e?.message ?? e).replace(/^Error invoking remote method.*?: /, ''));
  } finally {
    busy = false;
  }
}

/** Tạm dừng: dừng ghi tạm thời, thời gian đứng yên. Tiếp tục thì ghi nối vào cùng file. */
export async function pause() {
  if (!state.recording || state.paused || busy) return;
  try {
    await recWin.webContents.executeJavaScript('window.__pauseRec()', true);
  } catch {
    return;
  }
  state = { ...state, paused: true, elapsedMs: state.elapsedMs + (Date.now() - state.resumedAt), resumedAt: 0 };
  ctx.onChange(getState());
}

export async function resume() {
  if (!state.recording || !state.paused || busy) return;
  try {
    await recWin.webContents.executeJavaScript('window.__resumeRec()', true);
  } catch {
    return;
  }
  state = { ...state, paused: false, resumedAt: Date.now() };
  ctx.onChange(getState());
}

export async function stop() {
  if (!state.recording || busy) return null;
  busy = true;
  const { file, name, ask } = state;
  try {
    await recWin?.webContents.executeJavaScript('window.__stopRec()', true);
  } catch {}
  await new Promise((resolve) => (out ? out.end(resolve) : resolve()));
  await cleanup();
  state = idle();
  ctx.onChange(getState()); // ghi xong rồi: tắt chấm đỏ và thanh REC trước khi hiện hộp thoại

  let finalPath = file;
  let note = path.basename(file);
  try {
    if (ask) {
      // Hỏi nơi lưu; nếu người dùng huỷ thì vẫn giữ bản ghi ở thư mục mặc định, không để mất.
      mkdirSync(recordingsDir(), { recursive: true });
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Lưu bản ghi âm',
        defaultPath: path.join(recordingsDir(), name),
        filters: [{ name: 'MP3', extensions: ['mp3'] }],
      });
      if (canceled || !filePath) {
        mkdirSync(defaultDir(), { recursive: true });
        finalPath = path.join(defaultDir(), name);
        note = `Bạn chưa chọn nơi lưu nên file nằm ở ${defaultDir()}`;
      } else {
        finalPath = filePath;
        note = path.basename(filePath);
      }
      await moveFile(file, finalPath);
    }
  } catch (e) {
    finalPath = file;
    note = `Không chuyển được file, bản ghi còn ở ${file}`;
  }
  busy = false;
  notify('Đã lưu bản ghi âm', note, () => shell.showItemInFolder(finalPath));
  return finalPath;
}
