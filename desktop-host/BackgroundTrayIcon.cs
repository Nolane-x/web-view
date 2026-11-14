using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Nolane.DesktopHost;

internal sealed class BackgroundTrayIcon : IDisposable
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "NolaneInfiniteBridge";
    private const string StartupChoiceValue = "NolaneInfiniteBridgeStartupChoice";
    private const uint NIM_ADD = 0, NIM_DELETE = 2, NIF_MESSAGE = 1, NIF_ICON = 2, NIF_TIP = 4;
    private const uint WM_NULL = 0, WM_RBUTTONUP = 0x0205, WM_LBUTTONDBLCLK = 0x0203;
    private const uint TPM_RIGHTBUTTON = 0x0002, TPM_RETURNCMD = 0x0100, TPM_NONOTIFY = 0x0080;
    private const uint MF_STRING = 0, MF_SEPARATOR = 0x0800, MF_CHECKED = 0x0008, MF_UNCHECKED = 0;
    private const uint IDM_OPEN = 1001, IDM_STARTUP = 1002, IDM_EXIT = 1003;
    private const uint WM_TRAY_CALLBACK = 0x8000 + 0x51;
    private const int GWLP_WNDPROC = -4;
    private readonly IntPtr _hwnd;
    private readonly Action _exit;
    private readonly WindowProc _windowProc;
    private readonly IntPtr _previousProc;
    private bool _disposed;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint Size;
        public IntPtr Window;
        public uint Id;
        public uint Flags;
        public uint CallbackMessage;
        public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public uint State;
        public uint StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public uint TimeoutOrVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public uint InfoFlags;
        public Guid GuidItem;
        public IntPtr BalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }

    private delegate IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")]
    private static extern IntPtr CallWindowProc(IntPtr previous, IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern IntPtr LoadIcon(IntPtr instance, IntPtr iconName);
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenu(IntPtr menu, uint flags, UIntPtr id, string? text);
    [DllImport("user32.dll")]
    private static extern uint CheckMenuItem(IntPtr menu, uint id, uint flags);
    [DllImport("user32.dll")]
    private static extern uint TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr hwnd, IntPtr rect);
    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    public BackgroundTrayIcon(IntPtr hwnd, Action exit)
    {
        _hwnd = hwnd;
        _exit = exit;
        _windowProc = OnWindowMessage;
        _previousProc = SetWindowLongPtr(_hwnd, GWLP_WNDPROC, Marshal.GetFunctionPointerForDelegate(_windowProc));
        var data = new NotifyIconData
        {
            Size = (uint)Marshal.SizeOf<NotifyIconData>(),
            Window = _hwnd,
            Id = 1,
            Flags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            CallbackMessage = WM_TRAY_CALLBACK,
            Icon = LoadIcon(IntPtr.Zero, new IntPtr(32512)),
            Tip = "Nolane Infinite background bridge",
            Info = "",
            InfoTitle = ""
        };
        _ = Shell_NotifyIcon(NIM_ADD, ref data);
    }

    private IntPtr OnWindowMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WM_TRAY_CALLBACK)
        {
            var notification = unchecked((uint)lParam.ToInt64()) & 0xFFFF;
            if (notification == WM_RBUTTONUP) ShowMenu();
            else if (notification == WM_LBUTTONDBLCLK) OpenWorkspace();
            return IntPtr.Zero;
        }
        return CallWindowProc(_previousProc, hwnd, message, wParam, lParam);
    }

    private void ShowMenu()
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return;
        try
        {
            _ = AppendMenu(menu, MF_STRING, new UIntPtr(IDM_OPEN), "Open Nolane Infinite");
            _ = AppendMenu(menu, MF_SEPARATOR, UIntPtr.Zero, null);
            _ = AppendMenu(menu, MF_STRING, new UIntPtr(IDM_STARTUP), "Start with Windows");
            _ = CheckMenuItem(menu, IDM_STARTUP, MF_BYCOMMAND | (IsStartupEnabled() ? MF_CHECKED : MF_UNCHECKED));
            _ = AppendMenu(menu, MF_SEPARATOR, UIntPtr.Zero, null);
            _ = AppendMenu(menu, MF_STRING, new UIntPtr(IDM_EXIT), "Exit background bridge");
            _ = GetCursorPos(out var point);
            _ = SetForegroundWindow(_hwnd);
            var selected = TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY, point.X, point.Y, 0, _hwnd, IntPtr.Zero);
            _ = PostMessage(_hwnd, WM_NULL, IntPtr.Zero, IntPtr.Zero);
            if (selected == IDM_OPEN) OpenWorkspace();
            else if (selected == IDM_STARTUP) ToggleStartup();
            else if (selected == IDM_EXIT) _exit();
        }
        finally { _ = DestroyMenu(menu); }
    }

    private const uint MF_BYCOMMAND = 0;

    public static bool IsStartupEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
            return key?.GetValue(RunValue) is string value && !string.IsNullOrWhiteSpace(value);
        }
        catch { return false; }
    }

    public static void EnableStartup()
    {
        SetStartupRegistration(true, rememberChoice: true);
    }

    public static void EnableStartupAfterFirstConnection()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, true);
        if (key?.GetValue(StartupChoiceValue) is string) return;
        SetStartupRegistration(true, rememberChoice: true);
    }

    private static void SetStartupRegistration(bool enabled, bool rememberChoice)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, true);
        if (key is null) return;
        if (enabled)
        {
            var executable = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable)) return;
            key.SetValue(RunValue, $"\"{executable}\" --background");
            if (rememberChoice) key.SetValue(StartupChoiceValue, "enabled");
        }
        else
        {
            key.DeleteValue(RunValue, false);
            if (rememberChoice) key.SetValue(StartupChoiceValue, "disabled");
        }
    }

    public static void DisableStartup()
    {
        try { SetStartupRegistration(false, rememberChoice: true); }
        catch { }
    }

    private static void ToggleStartup()
    {
        if (IsStartupEnabled()) DisableStartup();
        else EnableStartup();
    }

    private static void OpenWorkspace()
    {
        try { Process.Start(new ProcessStartInfo("https://nolane-x.github.io/web-view/") { UseShellExecute = true }); }
        catch { }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        var data = new NotifyIconData { Size = (uint)Marshal.SizeOf<NotifyIconData>(), Window = _hwnd, Id = 1 };
        _ = Shell_NotifyIcon(NIM_DELETE, ref data);
        _ = SetWindowLongPtr(_hwnd, GWLP_WNDPROC, _previousProc);
        GC.KeepAlive(_windowProc);
    }
}
