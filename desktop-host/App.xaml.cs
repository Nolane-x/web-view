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

        _window = new MainWindow();
        var hwnd = WindowNative.GetWindowHandle(_window);
        _tray = new BackgroundTrayIcon(hwnd, () => _window?.Close(), RestartBackgroundBridge);
        _window.SetTrayNotificationHandler(_tray.ShowNotification);
        _window.Closed += (_, _) =>
        {
            _tray?.Dispose();
            _tray = null;
            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();
            _instanceMutex = null;

            // Release the single-instance mutex before launching the replacement process.
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
        _window.Activate();
    }
}
