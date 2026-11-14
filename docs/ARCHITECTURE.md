# Architecture and compatibility boundary

## Static workspace

The published website is a static HTML/CSS/JavaScript application. It stores workspace snapshots locally in IndexedDB with localStorage fallback. The service worker caches only the workspace shell; it does not proxy website traffic.

## Website display modes

A conventional iframe can be blocked by CSP frame-ancestors or X-Frame-Options. A restrictive opaque-origin sandbox can also break applications that require origin-bound storage, service workers, IndexedDB or authentication APIs. Compatibility sandboxing expands the trust boundary and still cannot override a host's anti-framing policy.

The reliable immediate path is **Live Chrome Surface** in Browser Companion v0.2.13. It operates on the user's real Chrome tab rather than creating a second embedded browsing context.

## Live Chrome Surface (MV3 companion v0.2.13)

The extension uses a tab-scoped capture/control pipeline:

1. The user opens a website in a normal Chrome tab, opens the Companion action from that active tab, and explicitly starts the stream.
2. The service worker discovers an open workspace tab using the exact Nolane URL pattern and verifies the content-script bridge with a versioned ping before recording its tab ID. The verified ID is mirrored to local storage so an extension reload does not erase it; every use still revalidates the tab and bridge. If the page is open but the bridge did not survive an extension update, the popup offers an explicit page refresh instead of attempting a doomed stream.
3. The service worker attempts chrome.debugger.attach as an optional input-control capability. When available, Page.getLayoutMetrics obtains the CSS viewport dimensions used for pointer coordinate mapping. A debugger-attach failure (including Chromium's foreign-extension-frame restriction) does not abort capture; the surface continues in clearly labelled view-only mode. After a successful attach, Page.enable and Page.getLayoutMetrics are best-effort inspection features: their failure does not detach the Input controller. The workspace falls back to Chrome tab dimensions and refreshes the viewport on Chrome window-boundary changes.
4. Before creating a stream, the service worker checks chrome.tabCapture.getCapturedTabs() and reports an already-pending/active capture instead of attempting a duplicate. By default it moves the existing Nolane tab into a separate Chrome window with chrome.windows.create({tabId, focused: true}), leaving the source tab selected in its original window. The user can disable this behavior in the popup. It then calls chrome.tabCapture.getMediaStreamId with targetTabId set to the active website tab and consumerTabId bound to the workspace tab. The token is delivered immediately because it is one-use and short-lived.
5. The workspace page consumes the token with getUserMedia using Chrome's chromeMediaSource: tab constraints, then acknowledges only after its video element has decoded a real frame.
6. Pointer, wheel and keyboard events inside that card are sent to the workspace content script and service worker.
7. When CDP is available, the service worker checks the active session ID, browser-profile ID, exact workspace sender origin and tab ID, source tab ID and source origin, then sends only fixed Input.dispatchMouseEvent, Input.dispatchKeyEvent or Input.insertText commands via CDP. In view-only mode the input route is disabled and the card tells the user to focus the original tab.
8. Page.frameResized events trigger a debounced Page.getLayoutMetrics refresh; the new CSS viewport dimensions are sent back to the canvas so pointer mapping remains correct when Chrome is resized. The serialized input queue also coalesces consecutive pointer moves under backpressure and resolves superseded requests immediately, preventing per-frame waiter buildup while preserving discrete input order.

The capture stream includes audio and video. The workspace routes audio through a local AudioContext and keeps it muted until the user explicitly enables sound, so tab audio is not captured and the source page's audio is not muted by the extension. There is no signaling server, WebRTC relay, external proxy, server-side browser or upload of frames. The source tab remains the actual page with its real cookies, storage and origin; the canvas is a live video/control mirror, not a DOM clone.

On sufficiently wide normal source windows, the workspace window is positioned over the right portion of the source window to leave both surfaces partly visible without resizing the source page. Smaller/maximized windows use Chrome's default window placement.
On the first 12-second no-frame timeout, the workspace performs one soft recovery: it detaches and reattaches the existing MediaStream to the local video element, awaits a decoded frame, then re-arms the frame callback monitor. The manual **Refresh video** action uses the same path, with a three-attempt/five-minute limit. A failed soft recovery reattaches the original stream before reporting the failure; it never creates another capture token or changes the source website's session.

The popup also exposes a local Website Compatibility Engine. A recommended-action endpoint accepts commands only from the extension popup, recomputes the action from the current tab/session, and rejects stale commands. Refresh is relayed through the registered workspace to the matching surface; restarting capture first removes the previous ended session, then starts a new user-invoked capture. The static page never receives permission to create captures or arbitrary debugger sessions. It classifies the active tab from origin/path heuristics, diagnoses Chrome capture and media failures, and recommends an action based on track/capture state. A local origin-keyed history tracks attempts, successes, failures and health transitions, capped at 40 website origins. The analyzer never reads page DOM, cookies, response bodies, screenshots or URL query strings.
The compatibility report also includes Chrome/extension version, tab-capture states, decoded video dimensions, frame rate, presented/dropped frame counts, track mute/ready state, last frame-health state, active surface metadata and the last startup stage/error. A page-side requestVideoFrameCallback monitor flags a stream after 12 seconds without a new compositor-presented frame, reports recovery when frames resume, and pauses its stall timer when the workspace/card is hidden. The service worker persists only state transitions and a 15-second healthy heartbeat. The report never includes cookies, page HTML or full source URLs.

The service worker also watches chrome.tabCapture.onStatusChanged to persist pending/active capture state and tear down sessions on stopped/error events. It separately watches chrome.tabs.onUpdated for the source tab. A top-level origin change ends the stream even in view-only mode, where there is no CDP Page.frameNavigated event to rely on. Same-origin navigation can continue under the user's original capture approval.

### Permission and security boundary

The companion declares activeTab, tabCapture and debugger; tabs remains optional for the separate tab-list/import feature. Chrome's warning for debugger is intentionally strong: the permission technically provides powerful access to the page debugger backend and can read/change website data. This must not be treated as a low-privilege bookmark extension.

The code deliberately does not expose a generic CDP command bridge and does not call the Cookies, Network, response-body, DOM snapshot or page-storage APIs. Live messages are accepted only from the exact registered Nolane workspace tab, and each source tab is bound to a browser profile ID and expected top-level origin. The stream token is scoped to the designated workspace consumer tab and is one-use/short-lived. Only install the unpacked extension if the repository source is trusted.

### Limitations

- Chrome debugger attachment can conflict with DevTools already open for that target or pages embedding another extension's frame. Close DevTools; if CDP remains blocked, the video-only path should still work.
- The source page may detect remote debugging or behave differently while attached.
- Browser-owned UI (address bar, permission prompts, file chooser, passkeys, some popup/download flows), DRM-protected video and OS-level dialogs cannot be mirrored as normal page content; focus the source tab for those flows.
- Capturing and decoding video consumes CPU/GPU resources. The extension limits a workspace to three concurrent live surfaces; saved cards can be unlimited within the workspace's normal node cap.
- Chrome-only; minimum supported version is 116.
- Each source tab must be explicitly streamed while it is active. It is not a silent background-tab capture tool.

## Native Windows browser host

The current Windows implementation uses real WebView2 child controls in a transparent overlay owned by the browser window. The host is a background bridge rather than a second workspace application. WebView2 keeps its own user-data folder and sign-in profiles; it does not inherit Chrome cookies.

## Non-goals

- Reading Chrome's cookie database or extracting session tokens.
- Disabling browser same-origin protections.
- Proxying arbitrary websites through an external service.
- Claiming universal support for site-specific passkey, DRM or browser-owned UI flows.
- Uploading the user's workspace, notes or captured page frames to remote services.


## Windows background bridge integration (protocol v2)

The shipping Windows process does not host a second Nolane workspace window. It starts a loopback-only TCP listener on `127.0.0.1:43172`, implements a bounded WebSocket handshake, requires the exact `https://nolane-x.github.io` Origin and the `nolane.infinite.v2` subprotocol, and caps incoming text messages at 2 MiB. No HTTP.sys URL reservation or administrator elevation is required.

The website queries Chrome/Edge's granular `loopback-network` permission. A first-time connection is initiated only by a user click; once the permission is granted, the site reconnects automatically. The host starts with the current Windows user after the first successful website handshake, is single-instance, and lives in the notification area.

The host creates a transparent, borderless WinUI overlay window owned by the active Chrome/Edge top-level window. It discovers the browser page viewport through Chromium's `Chrome_RenderWidgetHostHWND` child window instead of estimating the browser chrome height. Each workspace sync carries CSS viewport dimensions and device scale; the native host matches those against the actual renderer HWND bounds and hides the overlay if it cannot find a confident match.

Website-card rectangles are expressed relative to the page viewport. The host creates one WebView2 child per eligible website card, positions them within the overlay, and applies a native window region made from the clipped card-body rectangles plus any open Downloads/Library panel. This leaves empty canvas regions click-through to the original website UI. The overlay stays non-activating and hides when the workspace tab is hidden, the browser is minimized, or another application becomes foreground.

Downloads, Library and Profiles are opened from the website toolbar; their native panels are rendered in the overlay at the browser viewport edge. The Windows process window itself is not a workspace users need to operate.

WebView2 keeps separate cookies and login profiles from Chrome. This architecture removes the regular need for the Chrome Companion but does not claim that Chrome cookies can be transferred. Real-world validation is still required for Chrome/Edge versions, browser zoom, DPI scaling, multi-monitor movement, fullscreen, tab focus, renderer HWND changes and the overlay's click-through behavior.
## Native browser control plane

The web-to-host protocol is a versioned, allow-listed command surface: back, forward, reload, stop, toggle mute and open external. Card controls are only rendered when a website is actually owned by the native host; a connected Companion Chrome tab is never covered. `native-bridge.js` validates command names, message shape, state values and HTTP(S) URLs, and its contract is covered by Node unit tests. Native state reports include history availability, audio state, title and current safe URL; the workspace persists the active URL so a later session returns to the last page rather than the originally imported URL.

The host detects the installed Evergreen WebView2 Runtime before initialization and watches for newer runtime versions. Per-site WebView2 permissions are never silently auto-granted: each request requires a native Allow once/Block dialog and is not persisted in the WebView profile. The built-in WebView2 download dialog remains user-controlled. New-window requests are allowed to open externally only when they were triggered by a user gesture, preventing background popup spam. URLs containing embedded username/password credentials or non-HTTP(S) schemes are rejected by the native navigation boundary.

The native toolbar includes a compact per-card address input. Its navigation command is separately constructed and validated in `native-bridge.js`, then validated a second time by the native host before calling `CoreWebView2.Navigate`. The host accepts only HTTP(S), with no embedded username/password and a bounded URL length. Redirects and link clicks continue to update the saved workspace URL through source/history events.


## Adaptive resource and failure policy

The host uses `GC.GetGCMemoryInfo().TotalAvailableMemoryBytes` to select a visible surface budget (2 / 3 / 4) and caps the suspended cache at twice that count, up to 8. The policy is intentionally conservative and is not a precise per-process memory meter. Each surface tracks its own bounded renderer recovery window: one automatic reload per two minutes, then manual retry. Unresponsive renderers are not automatically reloaded because WebView2 can repeatedly report them while a page remains frozen. GPU and utility process exits are informational because WebView2 recreates those process types. A shared browser-process exit is elevated to an app-level restart instruction because the controls sharing that environment must be recreated.


## Native download lifecycle

Each child WebView2's `DownloadStarting` event is attached to a single host-level download ledger. The host deliberately leaves `Handled=false` so WebView2 retains its native Save dialog; the in-app manager operates on the same `CoreWebView2DownloadOperation` for progress, pause/resume/cancel and completion. BytesChanged is UI-coalesced; state transitions are atomically persisted to a bounded local JSON history. History stores only the source host rather than the full URI/query, the absolute saved file path, MIME type and transfer metadata. On restart, in-progress records are marked interrupted and no stale `DownloadOperation` is fabricated; resume is only offered for a live operation when WebView2 reports `CanResume`.

Active/resumable download operations pin their owning browser surface. Off-screen surfaces with such downloads are hidden but not suspended, and stale-card cleanup/cache eviction marks them pending removal rather than destroying their WebView2 control. The state-change handler releases a pending surface when no active or resumable operation remains.


## Native browser Library

Child WebView2 instances feed a host-side history ledger through NavigationCompleted, SourceChanged, HistoryChanged and DocumentTitleChanged. Events for the same card/URL are coalesced inside a four-second window and retained history is bounded at 500 entries. Before persistence, URLs are restricted to HTTP(S), reject embedded credentials, lose their fragment, and redact sensitive query names (token, secret, password, signature, authorization, credential, CSRF/XSRF, auth/session/key, API key and OAuth code fields). Bookmarks are explicit user actions from the per-card star control and are bounded at 200 entries. The native Library panel exposes History and Bookmarks; opening an item navigates the currently focused visible native card and falls back to the system browser only when no native target exists. The Library is stored in `browser-library.json` under the native WebView2 user-data folder and does not read Chrome history/bookmarks.

The Library search filters the already bounded local history/bookmark collections in memory by title, host or sanitized URL. It does not trigger network calls and the search box never receives unsanitized full URLs from page events.


## Library backup/restore

The Library can be exported through the Windows App SDK `Microsoft.Windows.Storage.Pickers` FileSavePicker and restored with FileOpenPicker. The portable JSON has schema version 1 and contains only the bounded History and Bookmark collections. Import rejects files above 5 MiB, unsupported schema versions and collection counts above 500/200. Every imported URL passes the same HTTP(S)/credential/query-redaction sanitizer; identifiers are regenerated and Chrome/profile/download data are never imported. Items are first staged and deduplicated against current data; a native confirmation dialog must approve the merge before the existing Library is mutated and atomically saved. This keeps malformed/canceled imports from partially modifying the user's data.

The unpackaged WinUI 3 host invokes the modern Windows Shell Common Item Dialog through COM (IFileSaveDialog/IFileOpenDialog) and owns it with the current WinUI HWND. Persistent client GUIDs retain separate open/save locations. The dialog uses a JSON-only filter, FOS_OVERWRITEPROMPT for export, FOS_FILEMUSTEXIST for import and FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR. The selected IShellItem is resolved to a filesystem path; JSON size/schema/count checks and staged sanitization remain separate from the picker. No picker-specific packages are added to the WebView2 dependency graph.

The WinUI 3 host does not add a second direct WebView2 NuGet reference; the Windows App SDK WinUI package supplies its supported WebView2 SDK/control integration. CI captures project.assets.json, package metadata and the evaluated MSBuild ReferencePath items before publish so missing Core projections can be traced to the actual package graph instead of guessed package versions.

The self-contained WinUI 3 host explicitly enables `WebView2EnableCsWinRTProjection=true`. Windows App SDK 1.8 documents this property for projects using the WinUI component package and WebView2 APIs; without it, the WebView2 projection can be absent from the compile reference graph even though the underlying NuGet package is restored. The host relies on the SDK's supplied WebView2 dependency and avoids a duplicate direct reference.

The shipping host project excludes `diagnostics/**` from default MSBuild items and explicitly removes nested diagnostic C#/XAML items. This is required because the diagnostic WinUI smoke-test projects live under the host repository folder; without the exclusion their generated `obj` files and `App.xaml`/window partial classes were auto-included into the shipping app, causing duplicate generated types and masking the real compiler diagnostics.

The shipping host declares `Microsoft.Web.WebView2 1.0.3179.45` directly. This version was recovered from the last known-good native Windows release's `.deps.json`; the explicit package reference makes the WebView2 projection dependency deterministic instead of relying on an implicit transitive package.

WinUI/WebView2 compile smoke projects are kept outside `desktop-host/` under `native-diagnostics/`. The native app project therefore uses normal WinUI SDK default item discovery without custom excludes/removes for nested projects, avoiding interference from diagnostic XAML during markup compilation.

The Shell file-picker COM declarations and `IFileDialog`/`IShellItem` interop now live in a dedicated non-XAML `WindowsShellFilePicker` type. `MainWindow` only passes its HWND to this helper; WinUI's XAML compiler no longer needs to inspect COM-import interfaces nested in the XAML-backed window class.


## Background Windows bridge and browser overlay (protocol v2)

The Windows process no longer needs to display a second Nolane workspace window. It runs as a background companion and listens only on `127.0.0.1:43172`. A single WebSocket endpoint at `/bridge` accepts only `Origin: https://nolane-x.github.io` and the `nolane.infinite.v2` subprotocol. The first JSON message must be `nolane.bridge.hello` with protocol 2. Incoming text messages are capped at 2 MiB. The service never binds to LAN interfaces.

The HTTPS workspace checks the browser's `loopback-network` permission. If permission is already granted, it reconnects automatically; if permission is still prompt, the user must press the Connect Windows bridge control so the browser can ask for permission from a user gesture. A denied permission is not bypassed. This is a browser-controlled Local Network Access boundary.

The workspace sends each visible card's viewport rectangle plus screen viewport geometry and device scale. The native process places a borderless transparent WinUI overlay over the browser page viewport, creates real WebView2 controls for eligible cards, and applies a native window region formed from visible clipped card rectangles. Pixels and pointer areas outside these rectangles remain transparent/click-through. The overlay is owned by the detected browser top-level window and is hidden when the Nolane tab is hidden or the foreground application leaves that browser/overlay ownership chain.

This mode removes the normal need for the Chrome Companion extension. It does not inherit Chrome's profile: WebView2 remains a separate browser engine and stores its own login state. A local WebSocket connection and coordinate model are necessary but not sufficient to prove pixel-perfect overlay compatibility; manual checks are still required for browser chrome insets, browser zoom, display scaling, multi-monitor moves, fullscreen, maximized windows, tab switching and focus.
