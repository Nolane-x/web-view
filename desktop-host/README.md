
## WebView2 projection CI smoke test

Windows CI compiles a minimal library that directly consumes the WinUI 3 WebView2 Core projection (`CoreWebView2Environment`, navigation event args and download operation) before compiling/publishing the full native host. This separates Windows App SDK/NuGet projection regressions from host-specific C# and XAML errors.

The host project explicitly excludes the nested `diagnostics/**` tree from SDK default globs. This prevents the diagnostic smoke-test projects and their generated `obj` XAML/C# files from being compiled into the shipping app. The smoke tests remain independent projects and are compiled separately by GitHub Actions.

The host pins `Microsoft.Web.WebView2 1.0.3179.45` directly. Keep this exact version synchronized with the SDK version verified in the native Windows release artifact.

The shipping WinUI project contains no nested test projects or diagnostic XAML; all compile smoke tests live under the repository-level `native-diagnostics/` folder to keep XAML item discovery isolated.

Windows Shell Common Item Dialog COM declarations are isolated in `WindowsShellFilePicker.cs`. The XAML-backed MainWindow passes only its HWND to the picker helper and contains no COM-import interfaces or structs.


## Background bridge mode

The shipping process is a background agent. It hosts `LocalBridgeServer` on IPv4 loopback only, enforces the exact published workspace Origin, and accepts only the versioned `nolane.infinite.v2` WebSocket subprotocol. The visible WinUI window is a transparent, borderless overlay whose native window region is the union of clipped website-card rectangles. The workspace page supplies screen viewport coordinates and per-card layout; empty overlay regions remain click-through.

The app moves to the Windows notification area. A successful, user-initiated website connection registers the current executable under the current user's Run key so the bridge can start silently at the next sign-in. The tray menu can disable startup or exit the process.

Browser Local Network Access permission is required on first connection. The browser's permission prompt is expected and must not be suppressed or worked around.
