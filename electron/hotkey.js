import { app, globalShortcut } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tổ hợp có phím Windows (kể cả Win+Shift+S của Snipping Tool) không đăng ký được bằng RegisterHotKey.
// Với các tổ hợp đó ta chạy trình phụ keyhook.exe: nó chặn phím ở mức hệ thống rồi báo lại "TRIGGER".
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'keyhook.exe') : path.join(root, 'native', 'keyhook.exe');

const NAMED = {
  space: 0x20, enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, backspace: 0x08,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  insert: 0x2d, delete: 0x2e, printscreen: 0x2c, pause: 0x13,
};

/** Tên phím -> mã phím ảo Windows, hoặc null nếu không hỗ trợ. */
function vkOf(name) {
  if (/^[a-z]$/i.test(name)) return name.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(name)) return name.charCodeAt(0);
  const f = /^f(\d{1,2})$/i.exec(name);
  if (f && +f[1] >= 1 && +f[1] <= 24) return 0x6f + +f[1];
  return NAMED[name.toLowerCase()] ?? null;
}

function parse(acc) {
  const parts = acc.split('+').map((s) => s.trim()).filter(Boolean);
  const mods = new Set();
  let key = null;
  for (const p of parts) {
    const m = p.toLowerCase();
    if (['super', 'win', 'windows', 'meta'].includes(m)) mods.add('win');
    else if (['ctrl', 'control', 'commandorcontrol', 'cmdorctrl'].includes(m)) mods.add('ctrl');
    else if (m === 'alt') mods.add('alt');
    else if (m === 'shift') mods.add('shift');
    else key = p;
  }
  return { mods, vk: key ? vkOf(key) : null };
}

export const usesWinKey = (acc) => parse(acc).mods.has('win');

let helper = null;
let stopping = false;
let restarts = 0;

function stopHelper() {
  stopping = true;
  helper?.kill();
  helper = null;
}

function startHelper(acc, onTrigger) {
  const { mods, vk } = parse(acc);
  const exe = helperPath();
  if (vk == null || !existsSync(exe)) return false;
  const flag = (m) => (mods.has(m) ? '1' : '0');
  stopping = false;
  const child = spawn(exe, [flag('win'), flag('ctrl'), flag('alt'), flag('shift'), String(vk)], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (!child.pid) return false;
  helper = child;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => chunk.includes('TRIGGER') && onTrigger());
  child.on('error', () => {});
  child.on('exit', () => {
    if (helper !== child) return;
    helper = null;
    // Trình phụ chết bất ngờ thì dựng lại tối đa 3 lần.
    if (!stopping && restarts++ < 3) setTimeout(() => startHelper(acc, onTrigger), 1000);
  });
  return true;
}

/** Đăng ký phím tắt chụp. Trả về true nếu thành công. */
export function apply(acc, onTrigger) {
  globalShortcut.unregisterAll();
  stopHelper();
  restarts = 0;
  if (usesWinKey(acc)) return startHelper(acc, onTrigger);
  try {
    return globalShortcut.register(acc, onTrigger);
  } catch {
    return false;
  }
}

export const dispose = stopHelper;
