using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
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

    private async void RestartBackgroundBridge()
    {
        var window = _window;
        if (window is null || !await window.ConfirmRestartAsync()) return;
        _restartAfterClose = true;
        window.Close();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        HostDiagnostics.Initialize();
        HostDiagnostics.Write("Application launch requested. Args: " + (Environment.GetCommandLineArgs().Length > 1 ? string.Join(" ", Environment.GetCommandLineArgs().Skip(1)) : "(none)"));
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            if (eventArgs.ExceptionObject is Exception error)
                HostDiagnostics.WriteException("unhandled-exception", error);
            else
                HostDiagnostics.Write("Unhandled non-Exception failure: " + Convert.ToString(eventArgs.ExceptionObject));
        };
        TaskScheduler.UnobservedTaskException += (_, eventArgs) =>
        {
            HostDiagnostics.WriteException("unobserved-task-exception", eventArgs.Exception);
            eventArgs.SetObserved();
        };

        try
        {
            _instanceMutex = new Mutex(true, @"Local\NolaneInfiniteBackgroundBridge", out var createdNew);
            if (!createdNew)
            {
                HostDiagnostics.Write("A second instance was prevented by the single-instance mutex.");
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
                HostDiagnostics.Write("Background host is shutting down.");
                _tray?.Dispose();
                _tray = null;

                // Stop the old listener and close WebView2 surfaces before relaunching.
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
                            HostDiagnostics.Write("Background host restart process launched.");
                        }
                        catch (Exception error)
                        {
                            HostDiagnostics.WriteException("restart-process-launch", error);
                        }
                    }
                }
            };
            window.Activate();
            HostDiagnostics.Write("WinUI host window activated in background mode.");
        }
        catch (Exception error)
        {
            HostDiagnostics.WriteException("application-launch", error);
            throw;
        }
    }
}
