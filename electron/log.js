import { app } from 'electron';
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

// Nhật ký chẩn đoán nhỏ gọn (tự xoay vòng khi quá 256 KB) để biết vì sao phím tắt/chụp không chạy khi app đã chạy lâu.
const MAX_BYTES = 256 * 1024;
let file = null;

export const logPath = () => path.join(app.getPath('userData'), 'snapnote.log');

export function log(...parts) {
  try {
    file ??= logPath();
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, file + '.old');
    const text = parts
      .map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ');
    appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
  } catch {
    // ghi nhật ký thất bại thì bỏ qua, không được làm hỏng app
  }
}
