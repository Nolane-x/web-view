using Microsoft.Web.WebView2.Core;

namespace Nolane.WebView2ProjectionSmokeTest;

public static class ProjectionApi
{
    public static Type EnvironmentType => typeof(CoreWebView2Environment);
    public static Type NavigationCompletedType => typeof(CoreWebView2NavigationCompletedEventArgs);
    public static Type DownloadOperationType => typeof(CoreWebView2DownloadOperation);

    public static string GetRuntimeVersion() =>
        CoreWebView2Environment.GetAvailableBrowserVersionString();

    public static CoreWebView2EnvironmentOptions CreateEnvironmentOptions() => new();
}
