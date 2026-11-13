
## WebView2 projection CI smoke test

Windows CI compiles a minimal library that directly consumes the WinUI 3 WebView2 Core projection (`CoreWebView2Environment`, navigation event args and download operation) before compiling/publishing the full native host. This separates Windows App SDK/NuGet projection regressions from host-specific C# and XAML errors.
