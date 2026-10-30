import { globalShortcut } from 'electron';
import { log } from './log.js';

// Phím tắt chụp được đăng ký trực tiếp với Windows (RegisterHotKey). Tổ hợp mà Windows đang giữ riêng
// (ví dụ Win+Shift+S của Snipping Tool) sẽ bị từ chối; khi đó app báo lỗi chứ không chặn phím ở mức hệ thống.
const keysOf = (acc) => acc.split('+').map((k) => k.trim().toLowerCase().replace(/^(win|windows|meta)$/, 'super'));

/** Có phải tổ hợp Win+Shift+S của Snipping Tool không. */
export const isWinSnip = (acc) => !!acc && keysOf(acc).sort().join('+') === 's+shift+super';

/** Đăng ký phím tắt chụp. Trả về true nếu thành công. */
export function apply(acc, onTrigger) {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(acc, onTrigger);
  } catch (e) {
    log('đăng ký phím lỗi:', e);
    return false;
  }
}

export const dispose = () => globalShortcut.unregisterAll();
