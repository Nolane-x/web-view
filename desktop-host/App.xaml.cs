using System;
using System.Threading;
using Microsoft.UI.Xaml;
using WinRT.Interop;

namespace Nolane.DesktopHost;

public partial class App : Application
{
    private Window? _window;
    private BackgroundTrayIcon? _tray;
    private Mutex? _instanceMutex;

    public App() => InitializeComponent();

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
        _tray = new BackgroundTrayIcon(hwnd, () => _window?.Close());
        _window.Closed += (_, _) =>
        {
            _tray?.Dispose();
            _tray = null;
            _instanceMutex?.ReleaseMutex();
            _instanceMutex?.Dispose();
            _instanceMutex = null;
        };
        _window.Activate();
    }
}
