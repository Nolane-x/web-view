using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;

namespace Nolane.DesktopHost;

public sealed partial class MainWindow : Window
{
    private const string WorkspaceUrl = "https://nolane-x.github.io/web-view/";
    private const string WorkspaceHost = "nolane-x.github.io";
    private const int MaxVisibleSurfaces = 4;
    private const int MaxCachedSurfaces = 8;

    private CoreWebView2Environment? _environment;
    private readonly Dictionary<string, BrowserSurface> _surfaces = new(StringComparer.Ordinal);
    private bool _workspaceReady;
    private long _syncRevision;
    private List<SurfaceDescriptor>? _pendingSurfaceSync;
    private bool _surfaceSyncRunning;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Nolane Infinite — Native Browser Host";
        WorkspaceView.Loaded += MainWindow_Loaded;
        SizeChanged += (_, _) => BrowserSurfaceLayer.InvalidateArrange();
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Nolane", "NativeWebView2", "UserData");
            Directory.CreateDirectory(userData);
            _environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userData, new CoreWebView2EnvironmentOptions());
            await WorkspaceView.EnsureCoreWebView2Async(_environment);
            WorkspaceView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            WorkspaceView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            WorkspaceView.CoreWebView2.NavigationStarting += Workspace_NavigationStarting;
            WorkspaceView.CoreWebView2.NavigationCompleted += Workspace_NavigationCompleted;
            WorkspaceView.CoreWebView2.NewWindowRequested += Workspace_NewWindowRequested;
            WorkspaceView.CoreWebView2.WebMessageReceived += Workspace_WebMessageReceived;
            WorkspaceView.Source = new Uri(WorkspaceUrl);
            StatusText.Text = "Loading private workspace…";
        }
        catch (Exception ex)
        {
            StatusText.Text = "WebView2 could not start";
            await ShowErrorAsync("The native browser host could not initialize. Make sure the Microsoft Edge WebView2 Runtime is installed, then restart Nolane.", ex.Message);
        }
    }

    private void Workspace_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsTrustedWorkspaceUri(e.Uri)) return;
        e.Cancel = true;
        OpenExternal(e.Uri);
    }

    private void Workspace_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess) { StatusText.Text = "Workspace load failed: " + e.WebErrorStatus; return; }
        _workspaceReady = true;
        StatusText.Text = "Native browser connected · up to four visible websites";
        PostWorkspaceMessage(new { type = "nolane.native.ready", protocol = 1, engine = "WebView2", maxVisibleSurfaces = MaxVisibleSurfaces });
    }

    private void Workspace_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        OpenExternal(e.Uri);
    }

    private void Workspace_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsTrustedWorkspaceUri(e.Source)) return;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            if (!TryGetString(root, "type", out var type)) return;
            if (!root.TryGetProperty("protocol", out var protocol) || protocol.GetInt32() != 1) return;
            if (type == "nolane.host.hello")
            {
                _workspaceReady = true;
                PostWorkspaceMessage(new { type = "nolane.native.ready", protocol = 1, engine = "WebView2", maxVisibleSurfaces = MaxVisibleSurfaces });
                return;
            }
            if (type != "nolane.surfaces.sync") return;
            if (!root.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) return;
            var parsed = new List<SurfaceDescriptor>();
            foreach (var item in items.EnumerateArray())
                if (TryParseDescriptor(item, out var descriptor)) parsed.Add(descriptor);
            _pendingSurfaceSync = parsed;
            _syncRevision++;
            if (!_surfaceSyncRunning)
            {
                _surfaceSyncRunning = true;
                _ = DrainSurfaceSyncQueueAsync();
            }
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            StatusText.Text = "Ignored an invalid workspace surface message.";
        }
    }

    private async Task DrainSurfaceSyncQueueAsync()
    {
        try
        {
            while (_pendingSurfaceSync is not null)
            {
                var items = _pendingSurfaceSync;
                _pendingSurfaceSync = null;
                var revision = _syncRevision;
                try { await SynchronizeSurfacesAsync(items, revision); }
                catch (Exception ex) { StatusText.Text = "Native surface sync failed: " + ex.Message; }
            }
        }
        finally
        {
            _surfaceSyncRunning = false;
            if (_pendingSurfaceSync is not null)
            {
                _surfaceSyncRunning = true;
                _ = DrainSurfaceSyncQueueAsync();
            }
        }
    }

    private async Task SynchronizeSurfacesAsync(List<SurfaceDescriptor> items, long revision)
    {
        if (revision != _syncRevision) return;
            var present = items.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var staleId in _surfaces.Keys.Where(id => !present.Contains(id)).ToArray())
                await RemoveSurfaceAsync(staleId);

            var activeCount = 0;
            foreach (var item in items.OrderByDescending(item => item.ZIndex))
            {
                if (revision != _syncRevision) return;
                if (!item.Visible || item.Width < 80 || item.Height < 60)
                {
                    if (_surfaces.TryGetValue(item.Id, out var hidden)) await SetSurfaceVisibleAsync(hidden, false);
                    continue;
                }
                if (activeCount >= MaxVisibleSurfaces)
                {
                    if (_surfaces.TryGetValue(item.Id, out var limited)) await SetSurfaceVisibleAsync(limited, false);
                    PublishSurfaceStatus(item.Id, "limit", "Only four website surfaces can be visible at once. Pan the canvas or hide another card.");
                    continue;
                }

                activeCount++;
                var surface = await GetOrCreateSurfaceAsync(item);
                if (surface is null) continue;
                surface.LastVisibleAt = DateTimeOffset.UtcNow;
                ApplyBounds(surface.View, item);
                await SetSurfaceVisibleAsync(surface, true);
                if (!StringComparer.Ordinal.Equals(surface.Url, item.Url))
                {
                    surface.Url = item.Url;
                    surface.View.CoreWebView2.Navigate(item.Url);
                    PublishSurfaceStatus(item.Id, "loading", "Navigating to " + SafeHost(item.Url));
                }
            }
            await EvictHiddenSurfacesAsync();
        StatusText.Text = $"Native browser connected · {activeCount}/{MaxVisibleSurfaces} visible website surfaces";
    }

    private async Task<BrowserSurface?> GetOrCreateSurfaceAsync(SurfaceDescriptor item)
    {
        if (_surfaces.TryGetValue(item.Id, out var existing)) return existing;
        var view = new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Visibility = Visibility.Collapsed
        };
        var surface = new BrowserSurface(item.Id, item.Url, view);
        _surfaces[item.Id] = surface;
        BrowserSurfaceLayer.Children.Add(view);
        ApplyBounds(view, item);
        try
        {
            await view.EnsureCoreWebView2Async(_environment);
            if (!_surfaces.ContainsKey(item.Id)) return null;
            var core = view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                OpenExternal(args.Uri);
            };
            core.NavigationStarting += (_, args) =>
            {
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) &&
                    (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
                     uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))) return;
                args.Cancel = true;
                OpenExternal(args.Uri);
            };
            core.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess) PublishSurfaceStatus(item.Id, "ready", SafeHost(core.Source));
                else PublishSurfaceStatus(item.Id, "error", "Navigation failed: " + args.WebErrorStatus);
            };
            core.ProcessFailed += (_, args) => PublishSurfaceStatus(item.Id, "error", "Browser renderer stopped: " + args.ProcessFailedKind);
            PublishSurfaceStatus(item.Id, "loading", "Starting native browser surface.");
            core.Navigate(item.Url);
            surface.Url = item.Url;
            surface.Initialized = true;
            return surface;
        }
        catch (Exception ex)
        {
            PublishSurfaceStatus(item.Id, "error", ex.Message);
            StatusText.Text = "Could not create a website surface: " + ex.Message;
            BrowserSurfaceLayer.Children.Remove(view);
            _surfaces.Remove(item.Id);
            return null;
        }
    }

    private async Task SetSurfaceVisibleAsync(BrowserSurface surface, bool visible)
    {
        if (!surface.Initialized) { surface.View.Visibility = visible ? Visibility.Visible : Visibility.Collapsed; return; }
        if (visible)
        {
            surface.View.Visibility = Visibility.Visible;
            if (surface.Suspended)
            {
                try { surface.View.CoreWebView2.Resume(); } catch { }
                surface.Suspended = false;
            }
        }
        else
        {
            surface.View.Visibility = Visibility.Collapsed;
            if (!surface.Suspended)
            {
                try { surface.Suspended = await surface.View.CoreWebView2.TrySuspendAsync(); }
                catch { surface.Suspended = false; }
            }
            PublishSurfaceStatus(surface.Id, "suspended", "This website is off-screen and has been suspended to save resources.");
        }
    }

    private async Task EvictHiddenSurfacesAsync()
    {
        var hidden = _surfaces.Values.Where(surface => surface.View.Visibility != Visibility.Visible)
            .OrderBy(surface => surface.LastVisibleAt).ToList();
        while (_surfaces.Count > MaxCachedSurfaces && hidden.Count > 0)
        {
            var oldest = hidden[0];
            hidden.RemoveAt(0);
            await RemoveSurfaceAsync(oldest.Id);
        }
    }

    private async Task RemoveSurfaceAsync(string id)
    {
        if (!_surfaces.Remove(id, out var surface)) return;
        try
        {
            if (surface.Initialized)
            {
                surface.View.CoreWebView2.Stop();
                surface.View.CoreWebView2.Navigate("about:blank");
                await surface.View.CoreWebView2.TrySuspendAsync();
            }
        }
        catch { }
        BrowserSurfaceLayer.Children.Remove(surface.View);
        surface.View.Visibility = Visibility.Collapsed;
        PublishSurfaceStatus(id, "suspended", "The browser surface was released from memory.");
    }

    private void ApplyBounds(WebView2 view, SurfaceDescriptor item)
    {
        Canvas.SetLeft(view, item.X);
        Canvas.SetTop(view, item.Y);
        Canvas.SetZIndex(view, item.ZIndex);
        view.Width = Math.Clamp(item.Width, 80, 2400);
        view.Height = Math.Clamp(item.Height, 60, 1800);
        view.Clip = new RectangleGeometry
        {
            Rect = new Windows.Foundation.Rect(
                item.ClipX, item.ClipY,
                Math.Clamp(item.ClipWidth, 0, view.Width),
                Math.Clamp(item.ClipHeight, 0, view.Height))
        };
    }

    private void PostWorkspaceMessage(object message)
    {
        try
        {
            if (_workspaceReady && WorkspaceView.CoreWebView2 is not null)
                WorkspaceView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
        }
        catch { }
    }

    private void PublishSurfaceStatus(string id, string state, string detail) =>
        PostWorkspaceMessage(new { type = "nolane.native.surface", id, state, detail });

    private static bool TryParseDescriptor(JsonElement element, out SurfaceDescriptor descriptor)
    {
        descriptor = default!;
        if (!TryGetString(element, "id", out var id) || !TryGetString(element, "url", out var url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return false;
        var x = ReadNumber(element, "x");
        var y = ReadNumber(element, "y");
        var width = ReadNumber(element, "width");
        var height = ReadNumber(element, "height");
        var clipX = ReadNumber(element, "clipX");
        var clipY = ReadNumber(element, "clipY");
        var clipWidth = ReadNumber(element, "clipWidth");
        var clipHeight = ReadNumber(element, "clipHeight");
        if (clipX < 0 || clipY < 0 || clipWidth < 0 || clipHeight < 0 ||
            clipX + clipWidth > width + 1 || clipY + clipHeight > height + 1) return false;
        var z = (int)Math.Clamp(ReadNumber(element, "zIndex"), -100000, 100000);
        var visible = element.TryGetProperty("visible", out var v) && v.ValueKind == JsonValueKind.True;
        descriptor = new SurfaceDescriptor(id, uri.ToString(), x, y, width, height,
            clipX, clipY, clipWidth, clipHeight, z, visible);
        return true;
    }

    private static bool TryGetString(JsonElement element, string name, out string value)
    {
        value = "";
        if (!element.TryGetProperty(name, out var p) || p.ValueKind != JsonValueKind.String) return false;
        value = p.GetString() ?? "";
        return !string.IsNullOrWhiteSpace(value);
    }

    private static double ReadNumber(JsonElement element, string name) =>
        element.TryGetProperty(name, out var p) && p.TryGetDouble(out var v) && double.IsFinite(v) ? v : 0;

    private static bool IsTrustedWorkspaceUri(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
        uri.Host.Equals(WorkspaceHost, StringComparison.OrdinalIgnoreCase) &&
        (uri.AbsolutePath.Equals("/web-view", StringComparison.OrdinalIgnoreCase) ||
         uri.AbsolutePath.StartsWith("/web-view/", StringComparison.OrdinalIgnoreCase));

    private static string SafeHost(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) ? uri.Host : "website";

    private static void OpenExternal(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "mailto" or "tel")) return;
        try { Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true }); } catch { }
    }

    private async Task ShowErrorAsync(string message, string detail)
    {
        var dialog = new ContentDialog
        {
            Title = "Nolane Native Web Host",
            Content = message + Environment.NewLine + Environment.NewLine + detail,
            CloseButtonText = "Close",
            XamlRoot = Content.XamlRoot
        };
        await dialog.ShowAsync();
    }

    private void ReloadWorkspace_Click(object sender, RoutedEventArgs e) => WorkspaceView.CoreWebView2?.Reload();

    private sealed class BrowserSurface(string id, string url, WebView2 view)
    {
        public string Id { get; } = id;
        public string Url { get; set; } = url;
        public WebView2 View { get; } = view;
        public bool Initialized { get; set; }
        public bool Suspended { get; set; }
        public DateTimeOffset LastVisibleAt { get; set; } = DateTimeOffset.UtcNow;
    }

    private sealed record SurfaceDescriptor(
        string Id, string Url, double X, double Y, double Width, double Height,
        double ClipX, double ClipY, double ClipWidth, double ClipHeight,
        int ZIndex, bool Visible);
}