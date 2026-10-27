// Trình phụ nghe phím tắt có phím Windows (ví dụ Win+Shift+S) bằng low-level keyboard hook.
// RegisterHotKey không đăng ký được các tổ hợp Windows giữ riêng, hook thì chặn được trước khi hệ thống xử lý.
//
// Dùng:  keyhook.exe <win> <ctrl> <alt> <shift> <vk>     (mỗi cờ là 0 hoặc 1, vk là mã phím ảo dạng số)
// Khi đúng tổ hợp: nuốt phím, in "TRIGGER" ra stdout. Thoát khi stdin đóng (tiến trình cha chết).
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class KeyHook
{
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
    static readonly UIntPtr OwnMark = new UIntPtr(0x534E4150); // đánh dấu phím do chính mình chèn để bỏ qua
    const byte VK_MASK = 0xE8; // phím không gán, dùng để Start menu không bật khi nhả phím Win

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vk, scan, flags, time; public UIntPtr extra; }

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

    static bool needWin, needCtrl, needAlt, needShift;
    static uint key;
    static bool swallowing;
    static readonly HookProc proc = Callback; // giữ tham chiếu để GC không thu hồi

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    static bool ModifiersMatch()
    {
        bool win = Down(0x5B) || Down(0x5C);
        return win == needWin && Down(0x11) == needCtrl && Down(0x12) == needAlt && Down(0x10) == needShift;
    }

    static IntPtr Callback(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (k.extra != OwnMark && k.vk == key)
            {
                int msg = wParam.ToInt32();
                bool isDown = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                if (isDown && ModifiersMatch())
                {
                    if (!swallowing) // giữ phím thì chỉ kích hoạt một lần
                    {
                        swallowing = true;
                        if (needWin)
                        {
                            keybd_event(VK_MASK, 0, 0, OwnMark);
                            keybd_event(VK_MASK, 0, 2, OwnMark);
                        }
                        Console.Out.WriteLine("TRIGGER");
                        Console.Out.Flush();
                    }
                    return (IntPtr)1;
                }
                if (!isDown && swallowing)
                {
                    swallowing = false;
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length < 5) return 2;
        needWin = args[0] == "1";
        needCtrl = args[1] == "1";
        needAlt = args[2] == "1";
        needShift = args[3] == "1";
        key = uint.Parse(args[4]);

        // Tiến trình cha (Electron) thoát thì stdin đóng -> tự thoát để không treo hook.
        new Thread(() => { while (Console.In.ReadLine() != null) { } Environment.Exit(0); }) { IsBackground = true }.Start();

        IntPtr hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) return 3;
        Application.Run();
        return 0;
    }
}
