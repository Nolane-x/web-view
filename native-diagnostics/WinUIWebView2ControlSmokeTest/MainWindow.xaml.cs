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
}
