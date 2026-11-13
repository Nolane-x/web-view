using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
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
    private readonly int _maxVisibleSurfaces = DetermineVisibleSurfaceBudget();

    private int MaxVisibleSurfaces => _maxVisibleSurfaces;
    private int MaxCachedSurfaces => Math.Min(8, MaxVisibleSurfaces * 2);

    private CoreWebView2Environment? _environment;
    private readonly Dictionary<string, BrowserSurface> _surfaces = new(StringComparer.Ordinal);
    private bool _workspaceReady;
    private long _syncRevision;
    private List<SurfaceDescriptor>? _pendingSurfaceSync;
    private bool _surfaceSyncRunning;
    private readonly SemaphoreSlim _permissionDialogGate = new(1, 1);
    private bool _runtimeUpdateAvailable;

    private static int DetermineVisibleSurfaceBudget()
    {
        long availableBytes;
        try { availableBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes; }
        catch { availableBytes = 0; }

        // Leave headroom for Windows, the workspace shell and the shared WebView2 process group.
        if (availableBytes <= 0) return 2;
        var availableGiB = availableBytes / (1024d * 1024d * 1024d);
        if (availableGiB <= 10) return 2;
        if (availableGiB <= 16) return 3;
        return 4;
    }

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
            string runtimeVersion;
            try { runtimeVersion = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (Exception runtimeError)
            {
                await ShowErrorAsync(
                    "The Microsoft Edge WebView2 Runtime is missing or unavailable. Install the Evergreen Runtime, then reopen Nolane.",
                    runtimeError.Message + Environment.NewLine + "https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                StatusText.Text = "WebView2 Runtime required";
                return;
            }

            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Nolane", "NativeWebView2", "UserData");
            Directory.CreateDirectory(userData);
            _environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userData, new CoreWebView2EnvironmentOptions());
            _environment.NewBrowserVersionAvailable += (_, _) =>
            {
                _runtimeUpdateAvailable = true;
                StatusText.Text = "A WebView2 security/runtime update is ready. Save your workspace and restart Nolane to apply it.";
            };
            _environment.BrowserProcessExited += (_, _) =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    StatusText.Text = "WebView2 browser process exited. Restart Nolane to restore all browser surfaces.";
                    foreach (var surface in _surfaces.Values.ToArray())
                        PublishSurfaceStatus(surface.Id, "error", "The shared WebView2 browser process exited. Restart Nolane to restore this website.");
                });
            };
            await WorkspaceView.EnsureCoreWebView2Async(_environment);
            WorkspaceView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            WorkspaceView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            WorkspaceView.CoreWebView2.NavigationStarting += Workspace_NavigationStarting;
            WorkspaceView.CoreWebView2.NavigationCompleted += Workspace_NavigationCompleted;
            WorkspaceView.CoreWebView2.NewWindowRequested += Workspace_NewWindowRequested;
            WorkspaceView.CoreWebView2.WebMessageReceived += Workspace_WebMessageReceived;
            WorkspaceView.CoreWebView2.ProcessFailed += (_, args) =>
                StatusText.Text = "Workspace browser process failed: " + args.ProcessFailedKind + ". Use Reload workspace.";
            WorkspaceView.Source = new Uri(WorkspaceUrl);
            StatusText.Text = "WebView2 " + runtimeVersion + " · Loading private workspace…";
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
        StatusText.Text = $"Native browser connected · adaptive budget {MaxVisibleSurfaces} visible / {MaxCachedSurfaces} cached";
        PostWorkspaceMessage(new { type = "nolane.native.ready", protocol = 1, engine = "WebView2", maxVisibleSurfaces = MaxVisibleSurfaces });
    }

    private void Workspace_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (e.IsUserInitiated) OpenExternal(e.Uri);
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
            if (type == "nolane.surface.command")
            {
                if (TryGetString(root, "id", out var surfaceId) && TryGetString(root, "action", out var action))
                {
                    string? targetUrl = null;
                    if (root.TryGetProperty("url", out var urlElement) && urlElement.ValueKind == JsonValueKind.String)
                        targetUrl = urlElement.GetString();
                    ExecuteSurfaceCommand(surfaceId, action, targetUrl);
                }
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
                    PublishSurfaceStatus(item.Id, "limit", $"This device's adaptive memory budget allows {MaxVisibleSurfaces} visible website surfaces. Bring the card to the front or hide another card.");
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
        StatusText.Text = $"WebView2 · {activeCount}/{MaxVisibleSurfaces} active · {MaxCachedSurfaces} cached max · adaptive memory budget" +
            (_runtimeUpdateAvailable ? " · Runtime update ready; restart Nolane to apply" : "");
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
                if (args.IsUserInitiated) OpenExternal(args.Uri);
            };
            core.NavigationStarting += (_, args) =>
            {
                if (IsSafeWebUri(args.Uri))
                {
                    PublishSurfaceState(surface, "loading", "Loading " + SafeHost(args.Uri));
                    return;
                }
                args.Cancel = true;
                OpenExternal(args.Uri);
            };
            core.NavigationCompleted += (_, args) =>
            {
                if (IsSafeWebUri(core.Source)) surface.Url = new Uri(core.Source).ToString();
                PublishSurfaceState(surface,
                    args.IsSuccess ? "ready" : "error",
                    args.IsSuccess ? SafeHost(core.Source) : "Navigation failed: " + args.WebErrorStatus);
            };
            core.SourceChanged += (_, _) =>
            {
                if (IsSafeWebUri(core.Source)) surface.Url = new Uri(core.Source).ToString();
                PublishSurfaceState(surface, "ready", "Address changed");
            };
            core.HistoryChanged += (_, _) => PublishSurfaceState(surface, "ready", "Navigation history updated");
            core.DocumentTitleChanged += (_, _) => PublishSurfaceState(surface, "ready", "Page title updated");
            core.IsMutedChanged += (_, _) => PublishSurfaceState(surface, "ready", "Audio setting updated");
            core.IsDocumentPlayingAudioChanged += (_, _) => PublishSurfaceState(surface, "ready", "Audio state updated");
            core.DownloadStarting += (_, args) =>
            {
                var fileName = Path.GetFileName(args.ResultFilePath);
                PublishSurfaceState(surface, "ready", string.IsNullOrWhiteSpace(fileName) ? "Download started" : "Download started: " + fileName);
                // Keep WebView2's native Save dialog. The user chooses the destination.
            };
            core.PermissionRequested += (_, args) => HandleSurfacePermissionAsync(surface, args);
            core.ProcessFailed += (_, args) => HandleSurfaceProcessFailure(surface, args);
            surface.Url = item.Url;
            surface.Initialized = true;
            PublishSurfaceState(surface, "loading", "Starting native browser surface.");
            core.Navigate(item.Url);
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

    private void HandleSurfaceProcessFailure(BrowserSurface surface, CoreWebView2ProcessFailedEventArgs args)
    {
        var kind = args.ProcessFailedKind;
        if (kind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            PublishSurfaceState(surface, "error", "The shared WebView2 browser process exited. Restart Nolane to recreate the browser environment.");
            return;
        }

        if (kind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            // WebView2 can raise this repeatedly while a page remains frozen; do not create a reload loop.
            PublishSurfaceState(surface, "error", "This website is not responding. Use Reload once it is safe to interrupt the page.");
            return;
        }

        if (kind == CoreWebView2ProcessFailedKind.RenderProcessExited)
        {
            var now = DateTimeOffset.UtcNow;
            if (now - surface.LastRendererRecoveryAt > TimeSpan.FromMinutes(2))
                surface.RendererRecoveryAttempts = 0;

            if (surface.RendererRecoveryAttempts < 1)
            {
                surface.RendererRecoveryAttempts++;
                surface.LastRendererRecoveryAt = now;
                PublishSurfaceState(surface, "loading", "The website renderer crashed. Nolane is attempting one bounded page recovery.");
                try
                {
                    surface.View.CoreWebView2.Reload();
                    return;
                }
                catch (Exception ex)
                {
                    PublishSurfaceState(surface, "error", "Automatic recovery failed: " + ex.Message + ". Use Reload manually.");
                    return;
                }
            }

            PublishSurfaceState(surface, "error", "The website renderer crashed repeatedly. Automatic recovery is paused; use Reload manually.");
            return;
        }

        if (kind == CoreWebView2ProcessFailedKind.GpuProcessExited ||
            kind == CoreWebView2ProcessFailedKind.UtilityProcessExited)
        {
            // WebView2 recreates these process types automatically; avoid reloading every website.
            PublishSurfaceState(surface, "ready", "WebView2 reported " + kind + ". The browser runtime handles recovery automatically.");
            return;
        }

        PublishSurfaceState(surface, "error", "WebView2 process event: " + kind + ". Reload this website if it remains unavailable.");
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
                PublishSurfaceState(surface, "ready", "Website resumed");
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

    private void ExecuteSurfaceCommand(string id, string action, string? targetUrl = null)
    {
        if (!_surfaces.TryGetValue(id, out var surface) || !surface.Initialized || surface.Suspended) return;
        var core = surface.View.CoreWebView2;
        try
        {
            switch (action)
            {
                case "navigate":
                    if (!IsSafeWebUri(targetUrl ?? "") || targetUrl!.Length > 4096)
                    {
                        PublishSurfaceState(surface, "error", "Only valid HTTP or HTTPS addresses without embedded credentials are allowed.");
                        break;
                    }
                    var destination = new Uri(targetUrl).AbsoluteUri;
                    surface.Url = destination;
                    core.Navigate(destination);
                    PublishSurfaceState(surface, "loading", "Navigating to " + SafeHost(destination));
                    break;
                case "back":
                    if (core.CanGoBack) core.GoBack();
                    break;
                case "forward":
                    if (core.CanGoForward) core.GoForward();
                    break;
                case "reload":
                    core.Reload();
                    break;
                case "stop":
                    core.Stop();
                    PublishSurfaceState(surface, "ready", "Navigation stopped");
                    break;
                case "toggle-mute":
                    core.IsMuted = !core.IsMuted;
                    PublishSurfaceState(surface, "ready", core.IsMuted ? "Website audio muted" : "Website audio unmuted");
                    break;
                case "open-external":
                    OpenExternal(core.Source);
                    break;
                default:
                    return;
            }
        }
        catch (Exception ex)
        {
            PublishSurfaceState(surface, "error", "Browser command failed: " + ex.Message);
        }
    }

    private async void HandleSurfacePermissionAsync(BrowserSurface surface, CoreWebView2PermissionRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            await _permissionDialogGate.WaitAsync();
            try
            {
                var origin = SafeHost(args.Uri);
                var dialog = new ContentDialog
                {
                    Title = "Website permission request",
                    Content = origin + " wants access to: " + args.PermissionKind +
                        Environment.NewLine + Environment.NewLine +
                        "Allow only if you expected this request. Nolane will not save this decision in the browser profile.",
                    PrimaryButtonText = "Allow once",
                    CloseButtonText = "Block",
                    DefaultButton = ContentDialogButton.Close,
                    XamlRoot = Content.XamlRoot
                };
                args.SavesInProfile = false;
                var result = await dialog.ShowAsync();
                args.State = result == ContentDialogResult.Primary
                    ? CoreWebView2PermissionState.Allow
                    : CoreWebView2PermissionState.Deny;
                PublishSurfaceState(surface, "ready",
                    result == ContentDialogResult.Primary
                        ? "Allowed one-time permission: " + args.PermissionKind
                        : "Blocked permission: " + args.PermissionKind);
            }
            finally
            {
                _permissionDialogGate.Release();
            }
        }
        catch
        {
            args.State = CoreWebView2PermissionState.Deny;
        }
        finally
        {
            deferral.Complete();
        }
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

    private void PublishSurfaceState(BrowserSurface surface, string state, string detail)
    {
        try
        {
            var core = surface.View.CoreWebView2;
            PostWorkspaceMessage(new
            {
                type = "nolane.native.surface",
                id = surface.Id,
                state,
                detail = StringRaw(detail, 240),
                url = IsSafeWebUri(core.Source) ? core.Source : "",
                title = StringRaw(core.DocumentTitle, 160),
                canGoBack = core.CanGoBack,
                canGoForward = core.CanGoForward,
                isMuted = core.IsMuted,
                isPlayingAudio = core.IsDocumentPlayingAudio
            });
        }
        catch
        {
            PublishSurfaceStatus(surface.Id, state, detail);
        }
    }

    private static string StringRaw(string? value, int maxLength) =>
        string.IsNullOrEmpty(value) ? "" : value[..Math.Min(value.Length, maxLength)];

    private void PublishSurfaceStatus(string id, string state, string detail) =>
        PostWorkspaceMessage(new { type = "nolane.native.surface", id, state, detail });

    private static bool IsSafeWebUri(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
         uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) &&
        string.IsNullOrEmpty(uri.UserInfo);

    private static bool TryParseDescriptor(JsonElement element, out SurfaceDescriptor descriptor)
    {
        descriptor = default!;
        if (!TryGetString(element, "id", out var id) || !TryGetString(element, "url", out var url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var uri) || !IsSafeWebUri(url)) return false;
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
        string.IsNullOrEmpty(uri.UserInfo) &&
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
        public DateTimeOffset LastRendererRecoveryAt { get; set; } = DateTimeOffset.MinValue;
        public int RendererRecoveryAttempts { get; set; }
    }

    private sealed record SurfaceDescriptor(
        string Id, string Url, double X, double Y, double Width, double Height,
        double ClipX, double ClipY, double ClipWidth, double ClipHeight,
        int ZIndex, bool Visible);
}