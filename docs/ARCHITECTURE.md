# Architecture and compatibility boundary

## Static workspace

The published website is a static HTML/CSS/JavaScript application. It stores workspace snapshots locally in IndexedDB with localStorage fallback. The service worker caches only the workspace shell; it does not proxy website traffic.

## Windows-native website display

The website is the only workspace interface. Website cards, canvas geometry, notes, navigation controls, browser profiles, Downloads and Library are coordinated by the web app and the local Windows background host.

The Windows host uses real WebView2 child controls inside a transparent overlay attached to the foreground Chrome/Edge page-render window. The website sends a bounded viewport working set and logical card geometry over a loopback-only WebSocket. The host owns navigation, authentication state, profile isolation, downloads and native browser permissions; it does not expose Chrome's cookies or profile store.

The first connection is initiated by a user gesture because Chrome/Edge requires Loopback Network Access permission. Once granted, the website reconnects automatically. The local service is restricted to IPv4 loopback, the exact Nolane HTTPS origin, the versioned WebSocket subprotocol and a bounded message size.

There is no Chrome extension, tab-capture, content-script or debugger/CDP input path in the supported product. Old workspace records may contain tab IDs from the retired implementation; loading/importing them preserves their website URL and visible card data while discarding those obsolete identifiers. Users sign in separately inside the WebView2 profile.

Conventional iframes remain subject to the source site's CSP/X-Frame-Options and origin-storage behavior. They are not the primary authenticated browser runtime; use the Windows host for full in-canvas interaction or open the URL in the system browser.

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

WebView2 keeps separate cookies and login profiles from Chrome. WebView2 is the sole supported in-canvas browser runtime and uses a separate browser profile; it does not import Chrome cookies or sign-in state. Real-world validation is still required for Chrome/Edge versions, browser zoom, DPI scaling, multi-monitor movement, fullscreen, tab focus, renderer HWND changes and the overlay's click-through behavior.
## Native browser control plane

The web-to-host protocol is a versioned, allow-listed command surface: back, forward, reload, stop, toggle mute and open external. Card controls are rendered for website cards while the native host owns their WebView2 surfaces. `native-bridge.js` validates command names, message shape, state values and HTTP(S) URLs, and its contract is covered by Node unit tests. Native state reports include history availability, audio state, title and current safe URL; the workspace persists the active URL so a later session returns to the last page rather than the originally imported URL.

The host detects the installed Evergreen WebView2 Runtime before initialization and watches for newer runtime versions. A new version triggers a Windows notification-area alert; the tray menu exposes a confirmed restart action. The prompt reports active/resumable downloads because closing the host interrupts their live operations. Restart waits for all WebView2 surfaces and the loopback listener to shut down before releasing the single-instance mutex and launching the replacement host. Per-site WebView2 permissions are never silently auto-granted: each request requires a native Allow once/Block dialog and is not persisted in the WebView profile. The built-in WebView2 download dialog remains user-controlled. New-window requests are allowed to open externally only when they were triggered by a user gesture, preventing background popup spam. URLs containing embedded username/password credentials or non-HTTP(S) schemes are rejected by the native navigation boundary.

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

This is the sole supported in-canvas browser runtime. It does not inherit Chrome's profile: WebView2 remains a separate browser engine and stores its own login state. A local WebSocket connection and coordinate model are necessary but not sufficient to prove pixel-perfect overlay compatibility; manual checks are still required for browser chrome insets, browser zoom, display scaling, multi-monitor moves, fullscreen, maximized windows, tab switching and focus.


## Windows first-run installation

The Windows ZIP includes a current-user installer and uninstaller. The installer stages the complete self-contained host under `%LOCALAPPDATA%\Programs\NolaneInfiniteBridge`, replaces the previous installation only after verifying the staged executable, creates a Start Menu shortcut and starts the background bridge. It does not require elevation. The host registers its Run-key startup entry after the first successful website handshake. A persistent user choice to disable startup is preserved even when the installer updates the executable path.

The uninstaller clears both the Run entry and its startup-choice marker, stops the host, removes the application directory and website shortcut, but preserves the WebView2 user-data folder unless `-RemoveUserData` is explicitly passed.


The startup-choice marker is stored under `HKCU\Software\Nolane\NolaneInfiniteBridge`, not under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. The Run key contains only the executable command, so Windows never tries to launch a preference string as a program. On successful website connection, the host migrates the temporary legacy marker out of Run and refreshes the executable path unless the user opted out.


## Native overlay geometry tests

Card and panel clipping uses the same `OverlayGeometry` helper to convert CSS viewport rectangles into bounded native pixel regions. The conversion floors left/top edges, ceils right/bottom edges, clamps to the measured renderer HWND bounds, rejects unusable DPI scales and drops sub-two-pixel regions. A standalone .NET smoke test covers negative canvas positions, partial cards at the viewport edges, offscreen cards, 150% DPI and panels larger than the viewport. This tests the coordinate math but does not replace desktop-level validation of the actual Chromium renderer HWND and pointer/focus behavior.


## Profile-scoped Downloads

Every WebView2 download records the originating card's browser profile. The Downloads panel can filter All profiles, Default, named profiles or Private sessions; the Clear finished action only removes completed/interrupted entries inside the selected filter. Historical records created before this field existed deserialize into Default. Private download metadata remains memory-only and is excluded from the local download-history file. The native Save dialog and user-selected destination remain unchanged: profile filtering is attribution and organization, not automatic filesystem segregation.


A standalone `DownloadProfileFilter` smoke test checks All, Default, named profiles and Private sessions independently. Matching is case-insensitive for named profile labels; private downloads never appear in a persistent named-profile filter.


## Large-workspace model, spatial index and viewport virtualization

Each space accepts at most 2,000 validated nodes. The persisted workspace remains a complete local model; the DOM is only its viewport projection. A uniform-grid spatial index (640 world units per cell) stores node bounds, de-duplicates candidates across cells, verifies exact rectangle intersection, and places unusually large items in a bounded overflow set to prevent unbounded cell fan-out. Invalid geometry is rejected; drag and resize update the index incrementally.

The camera queries the world-space viewport with a 280 CSS-pixel overscan margin. Ordinary off-screen cards are detached; selected cards are pinned; native WebView2 surfaces are positioned independently by the Windows overlay. Search remains workspace-wide without mounting every matching item. It indexes matches across the complete active space, keeps only viewport cards in the DOM, and uses Enter/Shift+Enter to move the camera to the next/previous result. The minimap draws markers into one high-DPI-aware Canvas.

The Windows bridge no longer measures native card bodies from `.node` DOM elements. Each body rectangle is derived from world position/size, canvas origin, camera translation and scale, plus the one-pixel card border and 39-pixel header. Native browser synchronization is a bounded viewport working set: it queries cards intersecting the real viewport, sorts by z-order, and sends at most eight candidates per frame. The host activates only its adaptive 2–4 renderer budget after successful initialization, allowing lower-z candidates to fill slots when a higher card cannot initialize. The complete set of native-eligible website-card IDs is sent only after workspace data changes or a new bridge handshake. This lets the host distinguish deleted cards from cards that simply moved off-screen; off-screen surfaces are hidden and may remain in the host's cache of at most 8, while removed cards are released unless an active download must be retained.

The 2,000-node ceiling is an explicit resource guard, not an infinite-storage promise. Raising it requires measured evidence across IndexedDB save/load, import/export, search, minimap, native sync payload size and camera movement. Manual Windows checks remain necessary for WebView2 clipping and overlay hit-testing after virtualization.


Browser profile choices and per-profile card usage are memoized from workspace data. Workspace persistence invalidates those derived caches, so camera frames and repeated card construction do not rescan every node for the same metadata.

Native camera-frame synchronization reads the active node model directly and does not call `syncActiveSpace()` per frame. The sanitized active-space snapshot is refreshed when workspace persistence is scheduled, avoiding repeated full-node cloning during pan and zoom while preserving the save/export sanitization boundary.

Canvas pan/zoom does not rebuild minimap markers. The minimap retains the workspace bounds and marker geometry until a node is created, removed, moved, resized or the backing Canvas dimensions change; ordinary camera updates only reposition/resize the viewport indicator. The selected card is fetched by ID from the spatial index instead of scanning the full workspace.

The native sync payload stays below the local bridge's 2 MiB message guard by construction: normal camera frames contain only visible descriptors, while the maximum 2,000-ID workspace membership snapshot is transmitted on data mutations rather than every animation frame. The Windows parser independently caps accepted viewport candidates at eight, then enforces the actual renderer budget after each surface initializes; it also validates the ID snapshot before replacing its known membership set.
Native workspace membership and profile summaries are sent as a revisioned snapshot independent of camera frames. The sender uses 256-entry chunks with a begin/chunk/commit envelope. The Windows receiver enforces monotonic revisions, a 24,000-entry protocol ceiling, exact chunk sizes, unique safe IDs and bounded profile counts; it replaces both accepted membership and profile usage only after every chunk arrives. Until that commit, viewport descriptors are not treated as a complete membership list, so cached off-screen WebView2 surfaces cannot be incorrectly evicted during reconnect. After commit the host emits an ACK carrying the exact revision. The sender clears its pending transfer only for that matching ACK; after five seconds without one it resends a fresh revision, superseding partial receiver state. Socket disconnect also clears the pending receiver transaction. The new host advertises `workspaceSnapshotProtocol: 1`; older protocol-v2 hosts retain the legacy inline snapshot format. Website URLs are capped at 4,096 characters at normalization time, matching the native descriptor parser's bound.

Workspace-wide search does not force all matching cards into the DOM. Matches are indexed as IDs across the active space, while viewport virtualization continues to mount only nearby cards and the selected card. Enter jumps to the next match, Shift+Enter to the previous match; the camera centers the target and the virtualizer mounts it.

Native profile usage is a separate dirty cache. Pan/zoom frames omit the profile summary entirely; it is re-sent only after structural workspace changes, profile assignments or a new bridge handshake.
Profile summaries are serialized as compact `[name,count]` tuples (while the host still accepts the previous object form). The Windows host parses the entire summary before replacing its last good state; it rejects invalid names/counts, more than 24,000 entries, or any aggregate above the 12×2,000-card workspace ceiling. Case-insensitive duplicate profile names are combined with wide-integer bounds, preventing integer overflow and partial updates. Workspace IDs are restricted to 80 safe ASCII characters and normalized URLs to 4,096 characters, so a maximum 2,000-ID snapshot plus the 12×2,000-profile summary and at most eight visible descriptors stays within the bridge's 2 MiB frame guard.

Workspace ingestion assigns a safe unique ID to each node and space. The first valid occurrence of an ID is preserved; later duplicate or unsafe IDs are regenerated. Invalid website records are rejected before they can reserve an ID. Normalization processes no more than 2,000 valid nodes per space and 12 valid spaces.
Spatial-index geometry also guards IEEE-754 edge cases: rectangles whose computed right/bottom edge collapses back to the origin are rejected, and non-safe-integer grid-cell coordinates use the overflow/fallback path instead of entering an increment loop that may stop making progress.

### Coordinate and camera normalization

Workspace node coordinates are normalized to the finite ±8,000,000 world-unit range. Camera translations are normalized against the same world-space budget multiplied by the active zoom scale, capping camera translation at 17,600,000 CSS pixels. This leaves headroom below Chromium's CSS length clamp while keeping the world far larger than the previous ±100,000-unit range. The same helpers are used by current and legacy workspace loading, JSON import, drag, pan, zoom, fit-to-content and search-result focus. Non-finite input falls back to a deterministic safe coordinate; scale remains inside the existing zoom limits. This avoids the former mismatch where a card could be dragged beyond ±100,000 units and then moved on reload because the persisted node and camera were clamped independently.


### Viewport origin rebasing (DOM coordinate frame)

The workspace model and `SpatialIndex` continue to store/query logical world coordinates. The browser DOM uses a render-only origin selected by `computeRenderOrigin(view, viewport, 4096)`, snapped to a 4,096-world-unit quantum around the viewport center. For a node at world coordinate `p` and origin `o`, the DOM child is positioned at `p - o`; the transformed world container uses `view.translation + o × view.scale`. Therefore:

`(p - o) × scale + (translation + o × scale) = p × scale + translation`

This keeps mounted card CSS coordinates local without changing any visible pixel. The origin is recalculated when camera/viewport geometry changes, and existing mounted nodes are repositioned in the same synchronous update as the parent transform. It is deliberately not persisted in workspace schema, indexed, or sent to WebView2: the Windows overlay continues to derive screen rectangles from logical node coordinates and the logical camera. The selected card may remain mounted outside the viewport; the current finite ±8,000,000 world bound keeps even those local coordinates below the browser CSS length guard. Any future expansion to effectively unbounded logical coordinates must add a dedicated parking layer for off-screen live video cards before relaxing that bound.

The spatial index has a deterministic 15,000-card correctness stress test. `node scripts/benchmark-spatial.mjs` separately measures index build, viewport-query p50/p95 and 500 incremental updates at 2k, 10k, 50k and 100k cards; it deliberately reports measurements without brittle wall-clock pass/fail thresholds.


### Multi-resolution spatial index

The `SpatialIndex` keeps two cell maps per logical node: the configured fine grid (default 640 world units) and a coarse grid at 64× that size. Each map is populated only when the rectangle spans at most 256 cells at that resolution; otherwise the item is placed into that layer's oversized set. Queries first estimate the fine cell coverage. If it exceeds 4,096 cells or cannot be represented safely, the query tries the coarse grid. Candidate IDs are deduplicated and then checked against the original rectangle, so grid cells are only a broad-phase filter. A full entry scan remains the correctness fallback only when both resolutions exceed the bounded query budget. Upserts and removals update both maps atomically at the method level, and tests explicitly guard the coarse-query path against accidental full scans.
