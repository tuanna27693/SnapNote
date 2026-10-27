// Biên dịch native/keyhook.cs bằng trình biên dịch C# có sẵn trong Windows (.NET Framework 4), không cần cài thêm.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

if (!existsSync(csc)) {
  console.error('Không tìm thấy csc.exe: ' + csc);
  process.exit(1);
}

execFileSync(
  csc,
  ['/nologo', '/target:winexe', '/optimize+', '/r:System.Windows.Forms.dll',
    '/out:' + path.join(root, 'native', 'keyhook.exe'), path.join(root, 'native', 'keyhook.cs')],
  { stdio: 'inherit' },
);
console.log('Đã biên dịch native/keyhook.exe');
