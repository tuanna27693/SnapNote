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

/** Mã phím ảo -> tên phím theo cách Electron đọc, hoặc null nếu không hỗ trợ. */
function nameOf(vk) {
  if ((vk >= 0x41 && vk <= 0x5a) || (vk >= 0x30 && vk <= 0x39)) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x87) return 'F' + (vk - 0x6f);
  const hit = Object.entries(NAMED).find(([, v]) => v === vk);
  if (!hit) return null;
  return { printscreen: 'PrintScreen', pageup: 'PageUp', pagedown: 'PageDown', return: 'Enter' }[hit[0]] ?? hit[0][0].toUpperCase() + hit[0].slice(1);
}

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
export const isWinSnip = (acc) => {
  const { mods, vk } = parse(acc);
  return mods.size === 2 && mods.has('win') && mods.has('shift') && vk === 0x53;
};

// Khi Windows đã nhả Win+Shift+S (chính sách DisableSnippingTool) thì thử đăng ký phím tắt thường trước,
// nhanh hơn trình phụ chặn phím; không được thì dùng trình phụ như cũ.
let preferNative = false;
export const setPreferNative = (v) => {
  preferNative = !!v;
};

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
  if (usesWinKey(acc)) {
    if (preferNative && isWinSnip(acc)) {
      try {
        if (globalShortcut.register(acc, onTrigger)) return true;
      } catch {}
    }
    return startHelper(acc, onTrigger);
  }
  try {
    return globalShortcut.register(acc, onTrigger);
  } catch {
    return false;
  }
}

let recorder = null;

/**
 * Chờ người dùng bấm một tổ hợp phím rồi trả về chuỗi như "Shift+Super+A" (null nếu bấm Esc / hết giờ).
 * Tạm dừng phím tắt đang dùng để bấm thử không làm kích hoạt chụp.
 */
export function recordCombo(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    cancelRecord();
    stopHelper();
    globalShortcut.unregisterAll();
    const exe = helperPath();
    if (!existsSync(exe)) return reject(new Error('Thiếu keyhook.exe, không ghi được phím tắt.'));
    const child = spawn(exe, ['record'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    recorder = child;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (recorder === child) recorder = null;
      child.kill();
      fn(value);
    };
    const timer = setTimeout(() => finish(resolve, null), timeoutMs);
    child.on('error', (e) => finish(reject, e));
    child.on('exit', () => finish(resolve, null));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line === 'CANCEL') return finish(resolve, null);
        const m = /^KEY (\d) (\d) (\d) (\d) (\d+)$/.exec(line);
        if (!m) continue;
        const name = nameOf(Number(m[5]));
        if (!name) return finish(reject, new Error('Phím này chưa được hỗ trợ làm phím tắt.'));
        const mods = [m[2] === '1' && 'Ctrl', m[3] === '1' && 'Alt', m[4] === '1' && 'Shift', m[1] === '1' && 'Super'].filter(Boolean);
        return finish(resolve, [...mods, name].join('+'));
      }
    });
  });
}

export const cancelRecord = () => recorder?.kill();

export const dispose = () => {
  cancelRecord();
  stopHelper();
};
