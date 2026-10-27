import { app, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import * as settings from './settings.js';

const { autoUpdater } = electronUpdater;
const FIRST_CHECK_MS = 15_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let status = { state: app.isPackaged ? 'idle' : 'dev' };
let notify = () => {};
let openApp = () => {};
let firstTimer = null;
let interval = null;
let manual = false;

function push(next) {
  status = next;
  notify(next);
}

function friendly(e) {
  const m = String(e?.message ?? e);
  if (/404|latest\.yml|Cannot find|ENOTFOUND|net::/i.test(m)) {
    return 'Không tìm thấy bản phát hành. Kiểm tra mạng và cấu hình GitHub (publish) trong package.json.';
  }
  return m.split('\n')[0];
}

export const getStatus = () => status;

export function init(onStatus, onOpenApp) {
  notify = onStatus;
  openApp = onOpenApp;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    push({ state: 'available', version: info.version });
    if (!manual && Notification.isSupported()) {
      const n = new Notification({ title: 'SnapNote có bản mới', body: `Phiên bản ${info.version} đã sẵn sàng để tải về.` });
      n.on('click', openApp);
      n.show();
    }
  });
  autoUpdater.on('update-not-available', () => push({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => push({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => push({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => push({ state: 'error', message: friendly(e) }));

  applySchedule();
}

/** Bật/tắt kiểm tra tự động theo cài đặt. */
export function applySchedule() {
  clearTimeout(firstTimer);
  clearInterval(interval);
  if (!app.isPackaged || !settings.get('autoCheckUpdates')) return;
  firstTimer = setTimeout(() => check(false), FIRST_CHECK_MS);
  interval = setInterval(() => check(false), INTERVAL_MS);
}

export async function check(isManual = true) {
  if (!app.isPackaged) return push({ state: 'dev' });
  if (['checking', 'downloading', 'ready'].includes(status.state)) return;
  manual = isManual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    push({ state: 'error', message: friendly(e) });
  }
}

export async function download() {
  if (status.state !== 'available') return;
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    push({ state: 'error', message: friendly(e) });
  }
}

export const install = () => autoUpdater.quitAndInstall();
