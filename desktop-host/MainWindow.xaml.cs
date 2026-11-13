using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.WebView2.Core;



namespace Nolane.DesktopHost;

public sealed partial class MainWindow : Window
{
    private const string WorkspaceUrl = "https://nolane-x.github.io/web-view/";
    private const string WorkspaceHost = "nolane-x.github.io";
    private const int MaxLibraryHistoryEntries = 500;
    private const int MaxLibraryBookmarkEntries = 200;
    private const long MaxLibraryBackupBytes = 5L * 1024 * 1024;
    private static readonly Guid LibraryBackupSaveClientGuid = new("D1E8F7A4-8B3C-4E6B-91C8-7A2D5E0F3411");
    private static readonly Guid LibraryBackupOpenClientGuid = new("7A5B2D91-4F6C-48A3-B8D2-1E9F6C0A5274");

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
    private string? _downloadHistoryPath;
    private string? _browserLibraryPath;
    private readonly List<DownloadEntry> _downloads = new();
    private readonly List<BrowserHistoryEntry> _browserHistory = new();
    private readonly List<BrowserBookmark> _browserBookmarks = new();
    private bool _showingBookmarks;
    private string _focusedSurfaceId = "";
    private int _downloadRefreshQueued;
    private int _downloadHistoryDirty;

    private static readonly JsonSerializerOptions DownloadJsonOptions = new()
    {
        WriteIndented = true
    };

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
            _downloadHistoryPath = Path.Combine(userData, "download-history.json");
            _browserLibraryPath = Path.Combine(userData, "browser-library.json");
            LoadDownloadHistory();
            LoadBrowserLibrary();
            RefreshDownloadsUi();
            RefreshLibraryUi();
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
                surface.PendingRemoval = false;
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
            view.GotFocus += (_, _) => _focusedSurfaceId = surface.Id;
            core.NavigationCompleted += (_, args) =>
            {
                if (IsSafeWebUri(core.Source)) surface.Url = new Uri(core.Source).ToString();
                if (args.IsSuccess) RecordBrowserHistory(surface);
                PublishSurfaceState(surface,
                    args.IsSuccess ? "ready" : "error",
                    args.IsSuccess ? SafeHost(core.Source) : "Navigation failed: " + args.WebErrorStatus);
            };
            core.SourceChanged += (_, _) =>
            {
                if (IsSafeWebUri(core.Source)) surface.Url = new Uri(core.Source).ToString();
                RecordBrowserHistory(surface);
                PublishSurfaceState(surface, "ready", "Address changed");
            };
            core.HistoryChanged += (_, _) =>
            {
                RecordBrowserHistory(surface);
                PublishSurfaceState(surface, "ready", "Navigation history updated");
            };
            core.DocumentTitleChanged += (_, _) =>
            {
                RecordBrowserHistory(surface);
                PublishSurfaceState(surface, "ready", "Page title updated");
            };
            core.IsMutedChanged += (_, _) => PublishSurfaceState(surface, "ready", "Audio setting updated");
            core.IsDocumentPlayingAudioChanged += (_, _) => PublishSurfaceState(surface, "ready", "Audio state updated");
            core.DownloadStarting += (_, args) => HandleDownloadStarting(surface, args);
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

    private void HandleDownloadStarting(BrowserSurface surface, CoreWebView2DownloadStartingEventArgs args)
    {
        var operation = args.DownloadOperation;
        if (operation is null)
        {
            PublishSurfaceState(surface, "error", "WebView2 did not provide a download operation.");
            return;
        }

        var entry = new DownloadEntry
        {
            Id = Guid.NewGuid().ToString("N"),
            Operation = operation,
            SurfaceId = surface.Id,
            SourceHost = SafeHost(operation.Uri),
            MimeType = StringRaw(operation.MimeType, 120),
            StartedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            LastPersistedTick = Environment.TickCount64,
            Status = "Starting download"
        };
        UpdateDownloadEntry(entry);
        _downloads.Insert(0, entry);
        TrimDownloadHistory();

        operation.BytesReceivedChanged += (_, _) =>
        {
            UpdateDownloadEntry(entry);
            var now = Environment.TickCount64;
            var last = Interlocked.Read(ref entry.LastPersistedTick);
            if (now - last >= 3000 && Interlocked.CompareExchange(ref entry.LastPersistedTick, now, last) == last)
                QueueDownloadUiRefresh(persist: true);
            else
                QueueDownloadUiRefresh();
        };
        operation.StateChanged += (_, _) =>
        {
            UpdateDownloadEntry(entry);
            Interlocked.Exchange(ref entry.LastPersistedTick, Environment.TickCount64);
            QueueDownloadUiRefresh(persist: true);
            if (!HasRetainedDownload(surface.Id)) ReleasePendingSurfaceIfPossible(surface.Id);
        };

        // Keep Handled=false so WebView2 displays its native Save dialog and the user chooses the destination.
        // The in-app manager observes and controls the same DownloadOperation.
        PublishSurfaceState(surface, "ready", "Download started: " + entry.FileName);
        QueueDownloadUiRefresh(persist: true);
    }

    private static void UpdateDownloadEntry(DownloadEntry entry)
    {
        var operation = entry.Operation;
        if (operation is null) return;
        try
        {
            entry.BytesReceived = Math.Max(0, operation.BytesReceived);
            var total = operation.TotalBytesToReceive;
            entry.TotalBytesToReceive = total > 0 ? total : null;
            var resultPath = operation.ResultFilePath;
            if (!string.IsNullOrWhiteSpace(resultPath) && Path.IsPathFullyQualified(resultPath))
            {
                entry.FilePath = resultPath;
                entry.FileName = Path.GetFileName(resultPath);
            }
            if (string.IsNullOrWhiteSpace(entry.FileName))
            {
                try { entry.FileName = Path.GetFileName(new Uri(operation.Uri).LocalPath); }
                catch { entry.FileName = ""; }
            }
            if (string.IsNullOrWhiteSpace(entry.FileName)) entry.FileName = "Website download";
            entry.State = operation.State;
            entry.CanResume = operation.State == CoreWebView2DownloadState.Interrupted && operation.CanResume;
            entry.InterruptReason = operation.InterruptReason.ToString();
            entry.MimeType = StringRaw(operation.MimeType, 120);
            entry.UpdatedAtUtc = DateTimeOffset.UtcNow;
            entry.Status = operation.State switch
            {
                CoreWebView2DownloadState.InProgress => entry.UserPaused ? "Paused" : "Downloading",
                CoreWebView2DownloadState.Interrupted => entry.InterruptReason == "UserCanceled"
                    ? (entry.UserPaused ? "Paused" : "Canceled or interrupted")
                    : "Interrupted · " + entry.InterruptReason,
                CoreWebView2DownloadState.Completed => "Completed",
                _ => operation.State.ToString()
            };
        }
        catch (Exception ex)
        {
            entry.Status = "Download status unavailable: " + StringRaw(ex.Message, 120);
        }
    }

    private void QueueDownloadUiRefresh(bool persist = false)
    {
        if (persist) Interlocked.Exchange(ref _downloadHistoryDirty, 1);
        if (Interlocked.Exchange(ref _downloadRefreshQueued, 1) != 0) return;
        if (!DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                RefreshDownloadsUi();
                if (Interlocked.Exchange(ref _downloadHistoryDirty, 0) == 1) SaveDownloadHistory();
            }
            finally
            {
                Interlocked.Exchange(ref _downloadRefreshQueued, 0);
                if (Volatile.Read(ref _downloadHistoryDirty) == 1) QueueDownloadUiRefresh();
            }
        }))
        {
            Interlocked.Exchange(ref _downloadRefreshQueued, 0);
        }
    }

    private void LoadDownloadHistory()
    {
        if (string.IsNullOrWhiteSpace(_downloadHistoryPath) || !File.Exists(_downloadHistoryPath)) return;
        try
        {
            var records = JsonSerializer.Deserialize<List<DownloadHistoryRecord>>(
                File.ReadAllText(_downloadHistoryPath), DownloadJsonOptions) ?? new List<DownloadHistoryRecord>();
            foreach (var record in records.OrderByDescending(item => item.StartedAtUtc).Take(100))
            {
                var safePath = !string.IsNullOrWhiteSpace(record.FilePath) && Path.IsPathFullyQualified(record.FilePath)
                    ? record.FilePath : "";
                var completedFileExists = record.State == nameof(CoreWebView2DownloadState.Completed) &&
                    safePath.Length > 0 && File.Exists(safePath);
                var status = completedFileExists
                    ? "Completed"
                    : record.State == nameof(CoreWebView2DownloadState.InProgress)
                        ? "Interrupted when Nolane closed"
                        : record.State == nameof(CoreWebView2DownloadState.Completed)
                            ? "Completed · file no longer exists"
                            : "Interrupted · " + StringRaw(record.InterruptReason, 80);
                _downloads.Add(new DownloadEntry
                {
                    Id = StringRaw(record.Id, 64),
                    FileName = StringRaw(record.FileName, 180),
                    SourceHost = StringRaw(record.SourceHost, 120),
                    FilePath = safePath,
                    MimeType = StringRaw(record.MimeType, 120),
                    BytesReceived = Math.Max(0, record.BytesReceived),
                    TotalBytesToReceive = record.TotalBytesToReceive > 0 ? record.TotalBytesToReceive : null,
                    StartedAtUtc = record.StartedAtUtc,
                    UpdatedAtUtc = record.UpdatedAtUtc,
                    Status = status,
                    IsHistorical = true
                });
            }
        }
        catch
        {
            // A malformed history file must never prevent the browser host from starting.
            _downloads.Clear();
        }
    }

    private void SaveDownloadHistory()
    {
        if (string.IsNullOrWhiteSpace(_downloadHistoryPath)) return;
        string? temporaryPath = null;
        try
        {
            foreach (var entry in _downloads) UpdateDownloadEntry(entry);
            var records = _downloads.Take(100).Select(entry => new DownloadHistoryRecord
            {
                Id = entry.Id,
                FileName = StringRaw(entry.FileName, 180),
                SourceHost = StringRaw(entry.SourceHost, 120),
                FilePath = StringRaw(entry.FilePath, 2048),
                MimeType = StringRaw(entry.MimeType, 120),
                BytesReceived = Math.Max(0, entry.BytesReceived),
                TotalBytesToReceive = entry.TotalBytesToReceive ?? 0,
                State = entry.State?.ToString() ?? "Interrupted",
                InterruptReason = StringRaw(entry.InterruptReason, 100),
                StartedAtUtc = entry.StartedAtUtc,
                UpdatedAtUtc = entry.UpdatedAtUtc
            }).ToList();
            temporaryPath = _downloadHistoryPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(records, DownloadJsonOptions));
            File.Move(temporaryPath, _downloadHistoryPath, true);
        }
        catch (Exception ex)
        {
            StatusText.Text = "Could not save download history: " + StringRaw(ex.Message, 100);
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(temporaryPath) && File.Exists(temporaryPath))
            {
                try { File.Delete(temporaryPath); } catch { }
            }
        }
    }

    private void TrimDownloadHistory()
    {
        while (_downloads.Count > 100)
        {
            var removableIndex = _downloads.FindLastIndex(entry =>
                entry.Operation?.State != CoreWebView2DownloadState.InProgress &&
                !(entry.Operation?.CanResume ?? false));
            if (removableIndex < 0) break;
            _downloads.RemoveAt(removableIndex);
        }
    }

    private void RefreshDownloadsUi()
    {
        var activeCount = _downloads.Count(entry => entry.Operation?.State == CoreWebView2DownloadState.InProgress);
        DownloadsButton.Content = $"Downloads ({activeCount})";
        DownloadsSummaryText.Text = activeCount == 0
            ? $"{_downloads.Count} recent item(s) · history stored on this device"
            : $"{activeCount} active · {_downloads.Count} recent item(s)";

        if (DownloadsPanel.Visibility != Visibility.Visible) return;
        DownloadsList.Children.Clear();
        if (_downloads.Count == 0)
        {
            DownloadsList.Children.Add(new TextBlock
            {
                Text = "No downloads yet. Files downloaded by websites will appear here.",
                TextWrapping = TextWrapping.Wrap,
                Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 145, 158, 180)),
                Margin = new Thickness(8, 18, 8, 18)
            });
            return;
        }

        foreach (var entry in _downloads.Take(100))
            DownloadsList.Children.Add(CreateDownloadCard(entry));
    }

    private UIElement CreateDownloadCard(DownloadEntry entry)
    {
        if (entry.Operation is not null) UpdateDownloadEntry(entry);
        var card = new Border
        {
            Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 25, 34, 49)),
            BorderBrush = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 49, 62, 83)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(11)
        };
        var content = new StackPanel { Spacing = 6 };
        content.Children.Add(new TextBlock
        {
            Text = entry.FileName,
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 235, 241, 250)),
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        content.Children.Add(new TextBlock
        {
            Text = entry.SourceHost + " · " + entry.Status,
            FontSize = 10,
            Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 151, 164, 185)),
            TextWrapping = TextWrapping.Wrap
        });

        var progress = new ProgressBar { Height = 5, Minimum = 0, Maximum = 100 };
        if (entry.TotalBytesToReceive is > 0)
        {
            progress.IsIndeterminate = false;
            progress.Value = Math.Clamp(entry.BytesReceived * 100d / entry.TotalBytesToReceive.Value, 0, 100);
        }
        else
        {
            progress.IsIndeterminate = entry.Operation?.State == CoreWebView2DownloadState.InProgress;
            progress.Value = entry.State == CoreWebView2DownloadState.Completed ? 100 : 0;
        }
        content.Children.Add(progress);

        var details = entry.TotalBytesToReceive is > 0
            ? FormatBytes(entry.BytesReceived) + " / " + FormatBytes(entry.TotalBytesToReceive.Value)
            : FormatBytes(entry.BytesReceived) + " received";
        if (!string.IsNullOrWhiteSpace(entry.InterruptReason) &&
            entry.State == CoreWebView2DownloadState.Interrupted)
            details += " · " + entry.InterruptReason;
        content.Children.Add(new TextBlock
        {
            Text = details,
            FontSize = 9,
            Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 122, 137, 160))
        });

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 };
        var operation = entry.Operation;
        var inProgress = operation?.State == CoreWebView2DownloadState.InProgress;
        var canResume = operation?.State == CoreWebView2DownloadState.Interrupted && operation.CanResume;
        actions.Children.Add(CreateDownloadAction("Pause", inProgress, () =>
        {
            try { entry.UserPaused = true; operation?.Pause(); UpdateDownloadEntry(entry); QueueDownloadUiRefresh(persist: true); }
            catch (Exception ex) { StatusText.Text = "Could not pause download: " + StringRaw(ex.Message, 100); }
        }));
        actions.Children.Add(CreateDownloadAction("Resume", canResume, () =>
        {
            try { entry.UserPaused = false; operation?.Resume(); UpdateDownloadEntry(entry); QueueDownloadUiRefresh(persist: true); }
            catch (Exception ex) { StatusText.Text = "Could not resume download: " + StringRaw(ex.Message, 100); }
        }));
        actions.Children.Add(CreateDownloadAction("Cancel", inProgress || canResume, () =>
        {
            try { operation?.Cancel(); entry.UserPaused = false; UpdateDownloadEntry(entry); QueueDownloadUiRefresh(persist: true); }
            catch (Exception ex) { StatusText.Text = "Could not cancel download: " + StringRaw(ex.Message, 100); }
        }));
        var fileExists = !string.IsNullOrWhiteSpace(entry.FilePath) && Path.IsPathFullyQualified(entry.FilePath) && File.Exists(entry.FilePath);
        actions.Children.Add(CreateDownloadAction("Open", fileExists, () => OpenDownloadedFile(entry)));
        actions.Children.Add(CreateDownloadAction("Folder", !string.IsNullOrWhiteSpace(entry.FilePath) && Path.IsPathFullyQualified(entry.FilePath) &&
            Directory.Exists(Path.GetDirectoryName(entry.FilePath)), () => ShowDownloadedFile(entry)));
        content.Children.Add(actions);
        card.Child = content;
        return card;
    }

    private static Button CreateDownloadAction(string label, bool enabled, Action action)
    {
        var button = new Button
        {
            Content = label,
            IsEnabled = enabled,
            Padding = new Thickness(8, 4, 8, 4),
            FontSize = 10
        };
        button.Click += (_, _) => action();
        return button;
    }

    private static string FormatBytes(long bytes)
    {
        var size = Math.Max(0, bytes);
        var units = new[] { "B", "KB", "MB", "GB", "TB" };
        var value = (double)size;
        var index = 0;
        while (value >= 1024 && index < units.Length - 1)
        {
            value /= 1024;
            index++;
        }
        return index == 0 ? $"{(long)value} {units[index]}" : $"{value:0.0} {units[index]}";
    }

    private void OpenDownloadedFile(DownloadEntry entry)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(entry.FilePath) || !Path.IsPathFullyQualified(entry.FilePath) || !File.Exists(entry.FilePath))
            {
                StatusText.Text = "The downloaded file is not available at its saved location.";
                return;
            }
            Process.Start(new ProcessStartInfo(entry.FilePath) { UseShellExecute = true });
        }
        catch (Exception ex) { StatusText.Text = "Could not open download: " + StringRaw(ex.Message, 100); }
    }

    private void ShowDownloadedFile(DownloadEntry entry)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(entry.FilePath) || !Path.IsPathFullyQualified(entry.FilePath))
            {
                StatusText.Text = "The download folder is not available.";
                return;
            }
            var folder = Path.GetDirectoryName(entry.FilePath);
            if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
            {
                StatusText.Text = "The download folder no longer exists.";
                return;
            }
            if (File.Exists(entry.FilePath))
                Process.Start(new ProcessStartInfo("explorer.exe") { Arguments = "/select,\"" + entry.FilePath + "\"", UseShellExecute = true });
            else
                Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true });
        }
        catch (Exception ex) { StatusText.Text = "Could not open download folder: " + StringRaw(ex.Message, 100); }
    }

    private void ToggleDownloads_Click(object sender, RoutedEventArgs e)
    {
        if (DownloadsPanel.Visibility != Visibility.Visible)
            LibraryPanel.Visibility = Visibility.Collapsed;
        DownloadsPanel.Visibility = DownloadsPanel.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        RefreshDownloadsUi();
    }

    private void CloseDownloads_Click(object sender, RoutedEventArgs e) =>
        DownloadsPanel.Visibility = Visibility.Collapsed;

    private void ClearFinishedDownloads_Click(object sender, RoutedEventArgs e)
    {
        _downloads.RemoveAll(entry =>
            entry.Operation?.State != CoreWebView2DownloadState.InProgress &&
            !(entry.Operation?.CanResume ?? false));
        SaveDownloadHistory();
        RefreshDownloadsUi();
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

    private bool HasRetainedDownload(string surfaceId)
    {
        return _downloads.Any(entry =>
        {
            if (!StringComparer.Ordinal.Equals(entry.SurfaceId, surfaceId)) return false;
            var operation = entry.Operation;
            return operation is not null &&
                (operation.State == CoreWebView2DownloadState.InProgress ||
                 (operation.State == CoreWebView2DownloadState.Interrupted && operation.CanResume));
        });
    }

    private void ReleasePendingSurfaceIfPossible(string surfaceId)
    {
        if (_surfaces.TryGetValue(surfaceId, out var surface) &&
            surface.PendingRemoval && !HasRetainedDownload(surfaceId))
            _ = RemoveSurfaceAsync(surfaceId);
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
            if (HasRetainedDownload(surface.Id))
            {
                PublishSurfaceStatus(surface.Id, "suspended", "This website is hidden, but its download is active or resumable. Nolane is keeping the browser operation alive.");
                return;
            }
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
        var hidden = _surfaces.Values
            .Where(surface => surface.View.Visibility != Visibility.Visible && !HasRetainedDownload(surface.Id))
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
        if (!_surfaces.TryGetValue(id, out var surface)) return;
        if (HasRetainedDownload(id))
        {
            surface.PendingRemoval = true;
            surface.View.Visibility = Visibility.Collapsed;
            PublishSurfaceStatus(id, "suspended", "This card was removed, but Nolane is retaining its browser until the download completes or is canceled.");
            return;
        }
        if (!_surfaces.Remove(id)) return;
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
                case "toggle-bookmark":
                    ToggleBookmark(surface);
                    PublishSurfaceState(surface, "ready", IsBookmarked(core.Source) ? "Page saved to Library" : "Bookmark removed");
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

    private string SanitizeLibraryUrl(string value)
    {
        if (!IsSafeWebUri(value) || !Uri.TryCreate(value, UriKind.Absolute, out var uri)) return "";
        try
        {
            var builder = new UriBuilder(uri) { Fragment = "" };
            var query = builder.Query.TrimStart('?');
            if (!string.IsNullOrEmpty(query))
            {
                var retained = new List<string>();
                foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
                {
                    var rawName = part.Split('=', 2)[0];
                    string name;
                    try { name = Uri.UnescapeDataString(rawName.Replace("+", " ")).ToLowerInvariant(); }
                    catch { name = rawName.ToLowerInvariant(); }

                    var sensitive = name.Contains("token", StringComparison.Ordinal) ||
                        name.Contains("secret", StringComparison.Ordinal) ||
                        name.Contains("password", StringComparison.Ordinal) ||
                        name.Contains("signature", StringComparison.Ordinal) ||
                        name.Contains("authorization", StringComparison.Ordinal) ||
                        name.Contains("credential", StringComparison.Ordinal) ||
                        name.Contains("csrf", StringComparison.Ordinal) ||
                        name.Contains("xsrf", StringComparison.Ordinal) ||
                        name is "code" or "auth" or "session" or "key" or "api_key" or "apikey" or "jwt" or "nonce" or "ticket";
                    if (!sensitive) retained.Add(part);
                }
                builder.Query = string.Join("&", retained);
            }
            return builder.Uri.AbsoluteUri;
        }
        catch { return ""; }
    }

    private bool IsBookmarked(string rawUrl)
    {
        var safeUrl = SanitizeLibraryUrl(rawUrl);
        return safeUrl.Length > 0 && _browserBookmarks.Any(item =>
            StringComparer.Ordinal.Equals(item.Url, safeUrl));
    }

    private void RecordBrowserHistory(BrowserSurface surface)
    {
        if (!surface.Initialized) return;
        string url;
        string title;
        try
        {
            var core = surface.View.CoreWebView2;
            url = SanitizeLibraryUrl(core.Source);
            title = StringRaw(core.DocumentTitle, 180);
        }
        catch { return; }

        if (url.Length == 0) return;
        if (string.IsNullOrWhiteSpace(title)) title = SafeHost(url);
        var now = DateTimeOffset.UtcNow;
        var recent = _browserHistory.FirstOrDefault(item =>
            item.SurfaceId == surface.Id &&
            StringComparer.Ordinal.Equals(item.Url, url) &&
            now - item.VisitedAtUtc < TimeSpan.FromSeconds(4));
        if (recent is not null)
        {
            recent.Title = title;
            recent.VisitedAtUtc = now;
        }
        else
        {
            _browserHistory.Insert(0, new BrowserHistoryEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                SurfaceId = surface.Id,
                Url = url,
                Title = title,
                Host = SafeHost(url),
                VisitedAtUtc = now
            });
        }
        if (_browserHistory.Count > 500)
            _browserHistory.RemoveRange(500, _browserHistory.Count - 500);

        SaveBrowserLibrary();
        if (LibraryPanel.Visibility == Visibility.Visible && !_showingBookmarks)
            RefreshLibraryUi();
    }

    private void ToggleBookmark(BrowserSurface surface)
    {
        var core = surface.View.CoreWebView2;
        ToggleBookmarkUrl(core.Source, core.DocumentTitle);
    }

    private void ToggleBookmarkUrl(string rawUrl, string rawTitle)
    {
        var url = SanitizeLibraryUrl(rawUrl);
        if (url.Length == 0) return;

        var existing = _browserBookmarks.FindIndex(item => StringComparer.Ordinal.Equals(item.Url, url));
        if (existing >= 0)
        {
            _browserBookmarks.RemoveAt(existing);
        }
        else
        {
            if (_browserBookmarks.Count >= 200)
                _browserBookmarks.RemoveAt(_browserBookmarks.Count - 1);
            var title = StringRaw(rawTitle, 180);
            _browserBookmarks.Insert(0, new BrowserBookmark
            {
                Id = Guid.NewGuid().ToString("N"),
                Url = url,
                Title = string.IsNullOrWhiteSpace(title) ? SafeHost(url) : title,
                Host = SafeHost(url),
                SavedAtUtc = DateTimeOffset.UtcNow
            });
        }

        SaveBrowserLibrary();
        RefreshLibraryUi();
    }

    private void LoadBrowserLibrary()
    {
        if (string.IsNullOrWhiteSpace(_browserLibraryPath) || !File.Exists(_browserLibraryPath)) return;
        try
        {
            var document = JsonSerializer.Deserialize<BrowserLibraryDocument>(
                File.ReadAllText(_browserLibraryPath), DownloadJsonOptions);
            if (document is null) return;

            foreach (var item in document.Bookmarks.OrderByDescending(entry => entry.SavedAtUtc).Take(200))
            {
                var url = SanitizeLibraryUrl(item.Url);
                if (url.Length == 0 || _browserBookmarks.Any(saved => StringComparer.Ordinal.Equals(saved.Url, url))) continue;
                item.Url = url;
                item.Title = StringRaw(item.Title, 180);
                item.Host = SafeHost(url);
                _browserBookmarks.Add(item);
            }

            foreach (var item in document.History.OrderByDescending(entry => entry.VisitedAtUtc).Take(500))
            {
                var url = SanitizeLibraryUrl(item.Url);
                if (url.Length == 0) continue;
                item.Url = url;
                item.Title = StringRaw(item.Title, 180);
                item.Host = SafeHost(url);
                item.SurfaceId = StringRaw(item.SurfaceId, 128);
                _browserHistory.Add(item);
            }
        }
        catch
        {
            // A damaged or stale Library file must never prevent the browser host from starting.
            _browserHistory.Clear();
            _browserBookmarks.Clear();
        }
    }

    private void SaveBrowserLibrary()
    {
        if (string.IsNullOrWhiteSpace(_browserLibraryPath)) return;
        string? temporaryPath = null;
        try
        {
            var document = new BrowserLibraryDocument
            {
                SchemaVersion = 1,
                ExportedAtUtc = DateTimeOffset.UtcNow,
                History = _browserHistory.Take(500).ToList(),
                Bookmarks = _browserBookmarks.Take(200).ToList()
            };
            temporaryPath = _browserLibraryPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(document, DownloadJsonOptions));
            File.Move(temporaryPath, _browserLibraryPath, true);
        }
        catch (Exception ex)
        {
            StatusText.Text = "Could not save browser Library: " + StringRaw(ex.Message, 100);
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(temporaryPath) && File.Exists(temporaryPath))
            {
                try { File.Delete(temporaryPath); } catch { }
            }
        }
    }

    private BrowserSurface? GetLibraryTargetSurface()
    {
        if (!string.IsNullOrWhiteSpace(_focusedSurfaceId) &&
            _surfaces.TryGetValue(_focusedSurfaceId, out var focused) &&
            focused.Initialized && focused.View.Visibility == Visibility.Visible)
            return focused;

        return _surfaces.Values
            .Where(surface => surface.Initialized && surface.View.Visibility == Visibility.Visible)
            .OrderByDescending(surface => surface.LastVisibleAt)
            .FirstOrDefault();
    }

    private void OpenLibraryUrl(string rawUrl)
    {
        var safeUrl = SanitizeLibraryUrl(rawUrl);
        if (safeUrl.Length == 0) return;
        var target = GetLibraryTargetSurface();
        if (target is null)
        {
            OpenExternal(safeUrl);
            return;
        }
        try
        {
            target.View.Focus(FocusState.Programmatic);
            target.View.CoreWebView2.Navigate(safeUrl);
        }
        catch (Exception ex)
        {
            StatusText.Text = "Could not open Library item: " + StringRaw(ex.Message, 100);
        }
    }

    private static bool MatchesLibraryQuery(string title, string host, string url, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return true;
        return (title + " " + host + " " + url).Contains(query.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static Button CreateLibraryAction(string label, Action action)
    {
        var button = new Button
        {
            Content = label,
            Padding = new Thickness(8, 4, 8, 4),
            FontSize = 10
        };
        button.Click += (_, _) => action();
        return button;
    }

    private UIElement CreateLibraryCard(string title, string subtitle, string primaryLabel, Action primaryAction,
        string? secondaryLabel = null, Action? secondaryAction = null)
    {
        var card = new Border
        {
            Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 25, 34, 49)),
            BorderBrush = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 49, 62, 83)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(11)
        };
        var content = new StackPanel { Spacing = 6 };
        content.Children.Add(new TextBlock
        {
            Text = title,
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 235, 241, 250)),
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        content.Children.Add(new TextBlock
        {
            Text = subtitle,
            FontSize = 10,
            Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 151, 164, 185)),
            TextWrapping = TextWrapping.Wrap
        });

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 };
        actions.Children.Add(CreateLibraryAction(primaryLabel, primaryAction));
        if (secondaryLabel is not null && secondaryAction is not null)
            actions.Children.Add(CreateLibraryAction(secondaryLabel, secondaryAction));
        content.Children.Add(actions);
        card.Child = content;
        return card;
    }

    private void RefreshLibraryUi()
    {
        var query = LibrarySearchBox.Text?.Trim() ?? "";
        LibraryButton.Content = $"Library ({_browserHistory.Count + _browserBookmarks.Count})";
        HistoryTabButton.IsEnabled = _showingBookmarks;
        BookmarksTabButton.IsEnabled = !_showingBookmarks;
        ClearHistoryButton.IsEnabled = !_showingBookmarks && _browserHistory.Count > 0;

        var bookmarkMatches = _browserBookmarks
            .Where(item => MatchesLibraryQuery(item.Title, item.Host, item.Url, query))
            .ToList();
        var historyMatches = _browserHistory
            .Where(item => MatchesLibraryQuery(item.Title, item.Host, item.Url, query))
            .ToList();
        LibrarySummaryText.Text = _showingBookmarks
            ? $"{bookmarkMatches.Count} of {_browserBookmarks.Count} saved page(s)"
            : $"{historyMatches.Count} of {_browserHistory.Count} visits · sensitive query values are removed";

        if (LibraryPanel.Visibility != Visibility.Visible) return;
        LibraryItems.Children.Clear();

        if (_showingBookmarks)
        {
            if (bookmarkMatches.Count == 0)
            {
                LibraryItems.Children.Add(new TextBlock
                {
                    Text = _browserBookmarks.Count == 0
                        ? "No bookmarks yet. Use the star button on a native website card to save its current page."
                        : "No bookmarks match this search.",
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 145, 158, 180)),
                    Margin = new Thickness(8, 18, 8, 18)
                });
                return;
            }

            foreach (var item in bookmarkMatches.Take(200))
            {
                var saved = item;
                LibraryItems.Children.Add(CreateLibraryCard(
                    saved.Title,
                    saved.Host + " · Saved " + saved.SavedAtUtc.ToLocalTime().ToString("g"),
                    "Open in card",
                    () => OpenLibraryUrl(saved.Url),
                    "Remove",
                    () =>
                    {
                        _browserBookmarks.RemoveAll(bookmark => bookmark.Id == saved.Id);
                        SaveBrowserLibrary();
                        RefreshLibraryUi();
                    }));
            }
        }
        else
        {
            if (historyMatches.Count == 0)
            {
                LibraryItems.Children.Add(new TextBlock
                {
                    Text = _browserHistory.Count == 0
                        ? "Pages you visit in native website cards will appear here."
                        : "No history entries match this search.",
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 145, 158, 180)),
                    Margin = new Thickness(8, 18, 8, 18)
                });
                return;
            }

            foreach (var item in historyMatches.Take(100))
            {
                var visited = item;
                var bookmarked = IsBookmarked(visited.Url);
                LibraryItems.Children.Add(CreateLibraryCard(
                    visited.Title,
                    visited.Host + " · " + visited.VisitedAtUtc.ToLocalTime().ToString("g"),
                    "Open in card",
                    () => OpenLibraryUrl(visited.Url),
                    bookmarked ? "Saved" : "Bookmark",
                    () =>
                    {
                        if (!IsBookmarked(visited.Url))
                            ToggleBookmarkUrl(visited.Url, visited.Title);
                    }));
            }
        }
    }

    private void ToggleLibrary_Click(object sender, RoutedEventArgs e)
    {
        if (LibraryPanel.Visibility != Visibility.Visible)
            DownloadsPanel.Visibility = Visibility.Collapsed;
        LibraryPanel.Visibility = LibraryPanel.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        RefreshLibraryUi();
    }

    private void LibrarySearch_TextChanged(object sender, TextChangedEventArgs e) =>
        RefreshLibraryUi();

    private async void ExportLibrary_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var selectedPath = PickLibraryBackupPath(save: true);
            if (selectedPath is null) return;

            var document = new BrowserLibraryDocument
            {
                SchemaVersion = 1,
                ExportedAtUtc = DateTimeOffset.UtcNow,
                History = _browserHistory.Take(MaxLibraryHistoryEntries).ToList(),
                Bookmarks = _browserBookmarks.Take(MaxLibraryBookmarkEntries).ToList()
            };
            var json = JsonSerializer.Serialize(document, DownloadJsonOptions);
            if (System.Text.Encoding.UTF8.GetByteCount(json) > MaxLibraryBackupBytes)
                throw new InvalidDataException("The Library backup is larger than the supported 5 MiB limit.");

            await File.WriteAllTextAsync(selectedPath, json);
            StatusText.Text = "Library backup exported · " +
                document.History.Count + " history entries · " + document.Bookmarks.Count + " bookmarks";
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("Could not export the Library backup.", StringRaw(ex.Message, 220));
        }
    }

    private async void ImportLibrary_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var selectedPath = PickLibraryBackupPath(save: false);
            if (selectedPath is null) return;

            var fullPath = Path.GetFullPath(selectedPath);
            var info = new FileInfo(fullPath);
            if (!info.Exists || info.Length <= 0 || info.Length > MaxLibraryBackupBytes)
                throw new InvalidDataException("Choose a non-empty JSON backup no larger than 5 MiB.");

            var json = await File.ReadAllTextAsync(fullPath);
            var backup = JsonSerializer.Deserialize<BrowserLibraryDocument>(json, DownloadJsonOptions)
                ?? throw new InvalidDataException("The selected file is not a valid Nolane Library backup.");

            if (backup.SchemaVersion != 1)
                throw new InvalidDataException("This Library backup uses an unsupported schema version.");
            if (backup.History is null || backup.Bookmarks is null ||
                backup.History.Count > MaxLibraryHistoryEntries ||
                backup.Bookmarks.Count > MaxLibraryBookmarkEntries)
                throw new InvalidDataException("The backup exceeds the supported history or bookmark limits.");

            var stagedHistory = new List<BrowserHistoryEntry>();
            var stagedBookmarks = new List<BrowserBookmark>();
            var now = DateTimeOffset.UtcNow;

            foreach (var item in backup.History)
            {
                if (item is null || string.IsNullOrWhiteSpace(item.Url) || item.Url.Length > 4096) continue;
                var safeUrl = SanitizeLibraryUrl(item.Url);
                if (safeUrl.Length == 0) continue;
                var visitedAt = item.VisitedAtUtc == default || item.VisitedAtUtc > now.AddDays(1)
                    ? now : item.VisitedAtUtc;
                var duplicate = _browserHistory.Any(existing =>
                    StringComparer.Ordinal.Equals(existing.Url, safeUrl) &&
                    Math.Abs((existing.VisitedAtUtc - visitedAt).TotalSeconds) < 1) ||
                    stagedHistory.Any(existing =>
                    StringComparer.Ordinal.Equals(existing.Url, safeUrl) &&
                    Math.Abs((existing.VisitedAtUtc - visitedAt).TotalSeconds) < 1);
                if (duplicate) continue;

                stagedHistory.Add(new BrowserHistoryEntry
                {
                    Id = Guid.NewGuid().ToString("N"),
                    SurfaceId = "",
                    Url = safeUrl,
                    Title = string.IsNullOrWhiteSpace(item.Title)
                        ? SafeHost(safeUrl) : StringRaw(item.Title, 180),
                    Host = SafeHost(safeUrl),
                    VisitedAtUtc = visitedAt
                });
            }

            foreach (var item in backup.Bookmarks)
            {
                if (item is null || string.IsNullOrWhiteSpace(item.Url) || item.Url.Length > 4096) continue;
                var safeUrl = SanitizeLibraryUrl(item.Url);
                if (safeUrl.Length == 0 ||
                    _browserBookmarks.Any(existing => StringComparer.Ordinal.Equals(existing.Url, safeUrl)) ||
                    stagedBookmarks.Any(existing => StringComparer.Ordinal.Equals(existing.Url, safeUrl)))
                    continue;

                var savedAt = item.SavedAtUtc == default || item.SavedAtUtc > now.AddDays(1)
                    ? now : item.SavedAtUtc;
                stagedBookmarks.Add(new BrowserBookmark
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Url = safeUrl,
                    Title = string.IsNullOrWhiteSpace(item.Title)
                        ? SafeHost(safeUrl) : StringRaw(item.Title, 180),
                    Host = SafeHost(safeUrl),
                    SavedAtUtc = savedAt
                });
            }

            if (stagedHistory.Count == 0 && stagedBookmarks.Count == 0)
            {
                StatusText.Text = "No new safe History or Bookmarks were found in that backup.";
                return;
            }

            var confirmation = new ContentDialog
            {
                Title = "Merge Library backup?",
                Content = "Nolane validated the backup and staged " +
                    stagedHistory.Count + " new history entries and " +
                    stagedBookmarks.Count + " new bookmarks. Existing items will be kept; duplicate bookmarks and visits will be skipped.",
                PrimaryButtonText = "Merge Library",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Close,
                XamlRoot = Content.XamlRoot
            };
            if (await confirmation.ShowAsync() != ContentDialogResult.Primary) return;

            _browserHistory.AddRange(stagedHistory);
            _browserHistory.Sort((left, right) => right.VisitedAtUtc.CompareTo(left.VisitedAtUtc));
            if (_browserHistory.Count > MaxLibraryHistoryEntries)
                _browserHistory.RemoveRange(MaxLibraryHistoryEntries, _browserHistory.Count - MaxLibraryHistoryEntries);

            _browserBookmarks.AddRange(stagedBookmarks);
            _browserBookmarks.Sort((left, right) => right.SavedAtUtc.CompareTo(left.SavedAtUtc));
            if (_browserBookmarks.Count > MaxLibraryBookmarkEntries)
                _browserBookmarks.RemoveRange(MaxLibraryBookmarkEntries, _browserBookmarks.Count - MaxLibraryBookmarkEntries);

            SaveBrowserLibrary();
            RefreshLibraryUi();
            StatusText.Text = "Library backup merged · " +
                stagedHistory.Count + " history entries · " + stagedBookmarks.Count + " bookmarks";
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("Could not import the Library backup.", StringRaw(ex.Message, 220));
        }
    }

    private void ShowHistory_Click(object sender, RoutedEventArgs e)
    {
        _showingBookmarks = false;
        RefreshLibraryUi();
    }

    private void ShowBookmarks_Click(object sender, RoutedEventArgs e)
    {
        _showingBookmarks = true;
        RefreshLibraryUi();
    }

    private void ClearHistory_Click(object sender, RoutedEventArgs e)
    {
        _browserHistory.Clear();
        SaveBrowserLibrary();
        RefreshLibraryUi();
    }

    private void CloseLibrary_Click(object sender, RoutedEventArgs e) =>
        LibraryPanel.Visibility = Visibility.Collapsed;

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
                isPlayingAudio = core.IsDocumentPlayingAudio,
                isBookmarked = IsBookmarked(core.Source)
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

    private sealed class DownloadEntry
    {
        public string Id { get; set; } = "";
        public CoreWebView2DownloadOperation? Operation { get; set; }
        public string SurfaceId { get; set; } = "";
        public string FileName { get; set; } = "Website download";
        public string SourceHost { get; set; } = "website";
        public string FilePath { get; set; } = "";
        public string MimeType { get; set; } = "";
        public long BytesReceived { get; set; }
        public long? TotalBytesToReceive { get; set; }
        public CoreWebView2DownloadState? State { get; set; }
        public bool CanResume { get; set; }
        public bool UserPaused { get; set; }
        public bool IsHistorical { get; set; }
        public string InterruptReason { get; set; } = "";
        public string Status { get; set; } = "Starting";
        public DateTimeOffset StartedAtUtc { get; set; }
        public DateTimeOffset UpdatedAtUtc { get; set; }
        public long LastPersistedTick;
    }

    private sealed class BrowserLibraryDocument
    {
        public int SchemaVersion { get; set; } = 1;
        public DateTimeOffset ExportedAtUtc { get; set; } = DateTimeOffset.UtcNow;
        public List<BrowserHistoryEntry> History { get; set; } = new();
        public List<BrowserBookmark> Bookmarks { get; set; } = new();
    }

    private sealed class BrowserHistoryEntry
    {
        public string Id { get; set; } = "";
        public string SurfaceId { get; set; } = "";
        public string Url { get; set; } = "";
        public string Title { get; set; } = "";
        public string Host { get; set; } = "";
        public DateTimeOffset VisitedAtUtc { get; set; }
    }

    private sealed class BrowserBookmark
    {
        public string Id { get; set; } = "";
        public string Url { get; set; } = "";
        public string Title { get; set; } = "";
        public string Host { get; set; } = "";
        public DateTimeOffset SavedAtUtc { get; set; }
    }

    private sealed class DownloadHistoryRecord
    {
        public string Id { get; set; } = "";
        public string FileName { get; set; } = "";
        public string SourceHost { get; set; } = "";
        public string FilePath { get; set; } = "";
        public string MimeType { get; set; } = "";
        public long BytesReceived { get; set; }
        public long TotalBytesToReceive { get; set; }
        public string State { get; set; } = "";
        public string InterruptReason { get; set; } = "";
        public DateTimeOffset StartedAtUtc { get; set; }
        public DateTimeOffset UpdatedAtUtc { get; set; }
    }

    private sealed class BrowserSurface(string id, string url, WebView2 view)
    {
        public string Id { get; } = id;
        public string Url { get; set; } = url;
        public WebView2 View { get; } = view;
        public bool Initialized { get; set; }
        public bool Suspended { get; set; }
        public bool PendingRemoval { get; set; }
        public DateTimeOffset LastVisibleAt { get; set; } = DateTimeOffset.UtcNow;
        public DateTimeOffset LastRendererRecoveryAt { get; set; } = DateTimeOffset.MinValue;
        public int RendererRecoveryAttempts { get; set; }
    }

    private sealed record SurfaceDescriptor(
        string Id, string Url, double X, double Y, double Width, double Height,
        double ClipX, double ClipY, double ClipWidth, double ClipHeight,
        int ZIndex, bool Visible);
}