using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.UI.Xaml;
using WinRT.Interop;

namespace Nolane.DesktopHost;

public partial class App : Application
{
    private MainWindow? _window;
    private BackgroundTrayIcon? _tray;
    private Mutex? _instanceMutex;
    private bool _restartAfterClose;

    public App() => InitializeComponent();

    private void RestartBackgroundBridge()
    {
        _restartAfterClose = true;
        _window?.Close();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _instanceMutex = new Mutex(true, @"Local\NolaneInfiniteBackgroundBridge", out var createdNew);
        if (!createdNew)
        {
            _instanceMutex.Dispose();
            _instanceMutex = null;
            Exit();
            return;
        }

        var window = new MainWindow();
        _window = window;
        var hwnd = WindowNative.GetWindowHandle(window);
        _tray = new BackgroundTrayIcon(hwnd, window.Close, RestartBackgroundBridge);
        window.SetTrayNotificationHandler(_tray.ShowNotification);
        window.Closed += async (_, _) =>
        {
            _tray?.Dispose();
            _tray = null;

            // Stop the old loopback listener and close every WebView2 surface before relaunching.
            await window.ShutdownTask;

            // Release the single-instance mutex before launching the replacement process.
            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();
            _instanceMutex = null;

            if (_restartAfterClose)
            {
                _restartAfterClose = false;
                var executable = Environment.ProcessPath;
                if (!string.IsNullOrWhiteSpace(executable) && File.Exists(executable))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(executable, "--background") { UseShellExecute = true });
                    }
                    catch { }
                }
            }
        };
        window.Activate();
    }
}
