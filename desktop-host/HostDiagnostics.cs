using System;
using System.IO;
using System.Text;

namespace Nolane.DesktopHost;

internal static class HostDiagnostics
{
    private static readonly object Gate = new();
    private static string? _logPath;

    public static string LogPath
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(_logPath)) return _logPath;
            var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(root, "Nolane", "NativeWebView2", "Logs", "host.log");
        }
    }

    public static void Initialize()
    {
        try
        {
            var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var directory = Path.Combine(root, "Nolane", "NativeWebView2", "Logs");
            Directory.CreateDirectory(directory);
            _logPath = Path.Combine(directory, "host.log");
            Write("------------------------------------------------------------");
            Write("Host diagnostics initialized. OS=" + Environment.OSVersion.VersionString +
                  "; ProcessArchitecture=" + (Environment.Is64BitProcess ? "x64" : "x86") +
                  "; Runtime=" + Environment.Version);
        }
        catch
        {
            // Diagnostics must never prevent the background host from starting.
        }
    }

    public static void Write(string message)
    {
        try
        {
            var line = DateTimeOffset.Now.ToString("O") + " [pid " + Environment.ProcessId + "] " + message + Environment.NewLine;
            lock (Gate)
            {
                var path = LogPath;
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.AppendAllText(path, line, new UTF8Encoding(false));
            }
        }
        catch
        {
            // File logging is best-effort and must not interrupt the app.
        }
    }

    public static void WriteException(string stage, Exception error)
    {
        if (error is null) return;
        Write("ERROR at " + stage + ": " + error);
        if (error.InnerException is not null)
            Write("INNER ERROR at " + stage + ": " + error.InnerException);
    }
}
