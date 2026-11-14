using Microsoft.Web.WebView2.Core;

namespace Nolane.WebView2ProjectionSmokeTest;

public static class ProjectionApi
{
    public static Type EnvironmentType => typeof(CoreWebView2Environment);
    public static Type NavigationCompletedType => typeof(CoreWebView2NavigationCompletedEventArgs);
    public static Type DownloadOperationType => typeof(CoreWebView2DownloadOperation);
    public static Type ControllerOptionsType => typeof(CoreWebView2ControllerOptions);

    public static CoreWebView2ControllerOptions CreatePrivateControllerOptions(CoreWebView2Environment environment)
    {
        var options = environment.CreateCoreWebView2ControllerOptions();
        options.IsInPrivateModeEnabled = true;
        return options;
    }

    public static string GetRuntimeVersion() =>
        CoreWebView2Environment.GetAvailableBrowserVersionString();

    public static CoreWebView2EnvironmentOptions CreateEnvironmentOptions() => new();
}
