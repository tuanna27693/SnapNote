import { execFile } from 'node:child_process';

// Win+Shift+S do Snipping Tool giữ. Chính sách DisableSnippingTool (cùng giá trị với hai file .bat tắt/bật lại)
// làm Windows nhả phím này; sau khi `gpupdate /force` là dùng được ngay, không cần khởi động lại máy.
const KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\TabletPC';

const run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout: String(stdout ?? '') }));
  });

/** Chính sách DisableSnippingTool đang bật (Snipping Tool bị tắt)? Đọc registry không cần quyền admin. */
export async function isDisabled() {
  const { stdout } = await run('reg', ['query', KEY, '/v', 'DisableSnippingTool']);
  return /DisableSnippingTool\s+REG_DWORD\s+0x1\b/i.test(stdout);
}

/**
 * Chạy một lệnh cố định với quyền admin (Windows hiện hộp xin quyền UAC).
 * Chỉ nhận chuỗi lệnh do chính module này dựng, không có dữ liệu người dùng; không ghi file tạm để tránh bị tráo.
 */
export function runElevated(cmdline, { elevate = true } = {}) {
  const verb = elevate ? '-Verb RunAs ' : '';
  const ps = `try { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c ${cmdline.replace(/'/g, "''")}' ${verb}-Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 1223 }`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
}

export const commandFor = (disable) =>
  disable
    ? `reg add "${KEY}" /v DisableSnippingTool /t REG_DWORD /d 1 /f && gpupdate /force`
    : `reg delete "${KEY}" /v DisableSnippingTool /f && gpupdate /force`;

/** Bật/tắt chính sách rồi trả về trạng thái thật đọc lại từ registry (không tin mã thoát). */
export async function setDisabled(disable) {
  await runElevated(commandFor(disable));
  return isDisabled();
}
