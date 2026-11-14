
## WebView2 projection CI smoke test

Windows CI compiles a minimal library that directly consumes the WinUI 3 WebView2 Core projection (`CoreWebView2Environment`, navigation event args and download operation) before compiling/publishing the full native host. This separates Windows App SDK/NuGet projection regressions from host-specific C# and XAML errors.

The host project explicitly excludes the nested `diagnostics/**` tree from SDK default globs. This prevents the diagnostic smoke-test projects and their generated `obj` XAML/C# files from being compiled into the shipping app. The smoke tests remain independent projects and are compiled separately by GitHub Actions.

The host pins `Microsoft.Web.WebView2 1.0.3179.45` directly. Keep this exact version synchronized with the SDK version verified in the native Windows release artifact.

The shipping WinUI project contains no nested test projects or diagnostic XAML; all compile smoke tests live under the repository-level `native-diagnostics/` folder to keep XAML item discovery isolated.
