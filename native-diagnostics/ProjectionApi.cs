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
        options.ProfileName = "NolaneSmokeProfile";
        options.IsInPrivateModeEnabled = true;
        return options;
    }

    public static Task ClearProfileDataAsync(CoreWebView2Profile profile) =>
        profile.ClearBrowsingDataAsync();

    public static void DeleteProfile(CoreWebView2Profile profile) =>
        profile.Delete();

    public static string GetRuntimeVersion() =>
        CoreWebView2Environment.GetAvailableBrowserVersionString();

    public static CoreWebView2EnvironmentOptions CreateEnvironmentOptions() => new();
}
