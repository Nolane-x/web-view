
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


## Windows installation

The self-contained ZIP includes `Install-NolaneInfinite.cmd` and `Uninstall-NolaneInfinite.cmd`. Run the installer from the extracted ZIP; it copies the host to the current user's Local AppData Programs folder, creates a website shortcut and starts the background bridge without elevation. The installer scripts themselves are not copied into the application folder. Uninstall defaults to retaining WebView2 profiles and Library/download history; `-RemoveUserData` removes that data explicitly.

The startup preference lives in a separate per-user settings key. The Run key contains only the executable command; the host migrates the older development marker out of Run on the next successful website connection.


Overlay geometry is implemented in `OverlayGeometry.cs` so card and panel regions use the same DPI-aware conversion. The Windows workflow runs a standalone smoke test for negative coordinates, clipped edges, offscreen cards, 150% display scale and panels larger than the viewport.


Downloads records carry the originating browser profile and the panel filters by profile. Older local history entries without the profile field remain assigned to Default; private-session download metadata is not written to disk. Download files continue to use the destination selected in WebView2's native Save dialog.
