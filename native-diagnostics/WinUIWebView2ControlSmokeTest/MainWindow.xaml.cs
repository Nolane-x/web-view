using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace Nolane.WinUIProjectionSmoke;

public sealed partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    public CoreWebView2EnvironmentOptions CreateOptions() => new();

    public string GetRuntimeVersion() => CoreWebView2Environment.GetAvailableBrowserVersionString();

    public void SubscribeToNavigation()
    {
        Browser.NavigationCompleted += (_, args) =>
        {
            if (!args.IsSuccess)
                Title = "Navigation error: " + args.WebErrorStatus;
        };
    }

    public CoreWebView2? GetCore() => Browser.CoreWebView2;

    public void CloseBrowserControl() => Browser.Close();

    public async Task ClearProfileDataAsync()
    {
        await Browser.CoreWebView2!.Profile.ClearBrowsingDataAsync();
    }

    public void DeleteProfile() => Browser.CoreWebView2!.Profile.Delete();

    public async Task InitializePrivateSessionAsync(CoreWebView2Environment environment)
    {
        var options = environment.CreateCoreWebView2ControllerOptions();
        options.ProfileName = "NolaneSmokeProfile";
        options.IsInPrivateModeEnabled = true;
        await Browser.EnsureCoreWebView2Async(environment, options);
    }
}
