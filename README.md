# Nolane Infinite

**A personal web workspace, not another bookmark page.**

Nolane Infinite is a local-first canvas for arranging websites, ideas and tools in one visual space.

🌐 **GitHub Pages:** https://nolane-x.github.io/web-view/

## What works today

- Infinite canvas with pointer-based pan and cursor-anchored zoom.
- Website cards with direct open-in-browser and a live Chrome surface mode that streams the actual tab into the canvas and forwards mouse/keyboard input locally.
- Notes with editable text and four color themes.
- Multiple named workspaces (up to 12), each with its own canvas, layout and saved items.
- Create, switch, rename and delete local workspaces.
- Drag, resize, select and remove canvas items.
- Workspace search and separate website/note views.
- Local persistence through IndexedDB, with a localStorage fallback.
- JSON export and import for the complete set of workspaces.
- PWA manifest and an offline-cached static app shell.
- Optional Chrome MV3 companion for user-selected tab import and return-to-original-tab.
- Responsive layout for desktop and smaller screens.
- GitHub Actions deployment to GitHub Pages.

## Privacy model

- The workspace has no application backend, account system or remote database.
- Layouts, notes and saved website addresses are stored in the current browser profile.
- The app does not request or read website cookies, passwords or service tokens.
- Website frames load directly from the website's original origin. Those sites receive their normal requests from the browser.
- The static hosting provider may receive ordinary delivery/security logs.
- Import/export files remain under the user's control.

## Important compatibility boundary

An iframe may still be blocked by CSP/X-Frame-Options, and sandboxed frames may break origin-bound storage. The primary path for full website interaction is the **Windows background bridge**: its native WebView2 child browsers are positioned over website cards in the Chrome/Edge window that contains Nolane. The website remains the workspace UI; the Windows process stays in the notification area and runs quietly in the background. It does not need a Chrome extension or debugger permission. A one-time Loopback Network Access permission is required by Chrome/Edge so the HTTPS website can connect to the local Windows process.

The optional Chrome MV3 Browser Companion is now included in extension/. It asks for the Tabs permission only after the user clicks its grant button, lets the user select open tabs, and adds their titles/URLs as workspace cards. Selecting a card focuses the original Chrome tab, so its existing login session stays in Chrome. The extension does not read cookies, passwords, page contents or tokens. It does not turn tabs into embedded DOM surfaces; universal authenticated surfaces still require a local browser runtime (for example a custom Chromium host or a native WebView host). See extension/README.md and docs/ARCHITECTURE.md.


## Legacy Chrome companion

The `extension/` directory remains in the repository for older workspaces and compatibility experiments. It is **not required for the current Windows background bridge** and is no longer part of the primary setup path. The native bridge uses WebView2 directly and does not ask Chrome for debugger, tab-capture or extension permissions.

## Run locally

Serve the repository over HTTP:

    python -m http.server 8000

Then open http://localhost:8000. IndexedDB and service workers work in secure contexts such as HTTPS and localhost.

## Deploy

One-time repository setup is required: open Settings → Pages → Build and deployment, then set Source to GitHub Actions. GitHub does not allow the workflow GITHUB_TOKEN to create the Pages site on its own. After that, the workflow in .github/workflows/pages.yml builds and deploys the static artifact whenever main changes. It runs a JavaScript syntax check and validates the web manifest before deployment.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| A | Add a website |
| N | Add a note |
| / | Focus workspace search |
| Space + drag | Pan the canvas |
| Ctrl/Cmd + S | Save locally |
| Delete | Remove the selected card |

## Project status

Nolane Infinite is a local-first web workspace with a static website UI and an optional Windows background browser runtime. Native WebView2 surfaces provide direct in-canvas interaction where iframe embedding is blocked, subject to the documented compatibility and resource limits. Chrome sign-in data remains separate from the WebView2 profiles.


## Windows background bridge and native web surfaces

The Windows host is a **background companion**, not a second workspace app. Run `Nolane.DesktopHost.exe` once; it moves to the notification area and stays out of the way. After a successful connection it registers itself to start with the current Windows user. The website remains the only place where users create, move, resize and manage website cards.

The bridge listens on IPv4 loopback only at `127.0.0.1:43172`. It accepts a WebSocket only from the exact `https://nolane-x.github.io` Origin and the `nolane.infinite.v2` subprotocol, and caps incoming messages at 2 MiB. Chrome/Edge requires a one-time **Loopback Network Access** permission when the user first clicks Connect Windows bridge on the website. Once granted, the site reconnects automatically on later visits while the Windows background process is running.

The native process detects the Chromium page-render window and aligns a transparent native overlay to its real viewport. The overlay contains real WebView2 website surfaces and follows canvas movement, zoom, card resizing and browser-window changes. Its native window region is restricted to visible website-card bodies and open native panels, so the empty canvas remains interactive and click-through. If the active Chromium viewport cannot be located confidently, the overlay stays hidden rather than drawing in the wrong place.

WebView2 has its own persistent browser profiles and sign-ins. It does not import Chrome cookies, passwords or browser profile data. The Chrome Companion source remains only as a legacy optional component; the current product path does not need it.

The website toolbar opens native Downloads, Library and Profiles panels over the workspace; users do not need to operate the Windows process window. Browser-owned UI such as file pickers, passkeys and some OS prompts still follows Windows/WebView2 behavior.

## Native browser controls and safety

Each native website card now has independent Back, Forward, Reload and Mute controls. The current HTTP(S) page address is synced back into the workspace, so navigation survives a future restart/export. WebView2 runtime availability is checked at startup and updates are detected; restart Nolane after a runtime update is ready. Camera, microphone, geolocation, notifications and other WebView2 permissions are requested through an explicit Allow once/Block prompt and are not persisted by Nolane. WebView2 keeps its native user-driven download dialog. Unsolicited `window.open` popups are blocked; user-initiated popups open in the system browser.

Native website cards also expose an address field in the card header. Enter a hostname or full HTTP(S) URL and press Enter to navigate that card in place; the host rejects unsafe schemes and embedded credentials, and the current URL is synced back into the saved workspace.


## Adaptive browser resource budget and crash recovery

The Windows host reads the memory budget exposed by the .NET runtime and selects a conservative visible-surface cap: up to 2 visible website surfaces at 10 GiB or less, 3 up to 16 GiB, and 4 above that. The hidden cache is capped at twice the visible budget (maximum 8). These are guardrails, not a hard RAM guarantee: actual memory consumption still depends on each website. A renderer crash gets at most one automatic reload per surface in a two-minute window; repeated crashes and unresponsive pages are surfaced for manual recovery instead of creating reload loops. GPU and utility process exits are reported without reloading every page because WebView2 handles those process types automatically. A shared browser-process exit requires restarting the native host.


The Windows Native Host also includes a Downloads panel for active/recent WebView2 transfers. It exposes progress, pause/resume/cancel, open-file and show-folder actions, and saves up to 100 recent records locally. It keeps WebView2's native destination chooser active and does not persist full download URLs or query strings.


The Native Host includes a private Library with browsing History and Bookmarks. History is capped at 500 visits and bookmarks at 200 pages. Entries are tagged with their named browser profile, and the Library defaults to the focused card's profile; All profiles is available as an explicit combined view. Opening a Library entry only targets a visible, non-private card using the same profile, and will not silently fall back to a different login. Library schema 2 preserves profile ownership while schema 1 backups remain importable into Default. Before an address is persisted, fragments and sensitive query keys (tokens, secrets, passwords, signatures, auth/session values, API keys and OAuth codes) are removed. This Library is local to the Native WebView2 user-data folder and does not read Chrome history or bookmarks.

The Native Library supports instant search across page title, domain and safe stored address in both History and Bookmarks.

Library data can be exported as a versioned JSON backup and merged on another Windows machine. Import validates the schema, a 5 MiB file limit, maximum history/bookmark counts and every URL before showing a confirmation; it never silently replaces the current Library. The backup contains only sanitized History and Bookmarks, not cookies, passwords, WebView2 profiles, download records or Chrome data.

Library backup/restore uses the native Windows Shell file dialog, with a JSON filter, overwrite confirmation and validation of existing import files.

The native host pins `Microsoft.Web.WebView2 1.0.3179.45` as a direct package reference. This is the exact SDK version found in the last known-good Windows release's `.deps.json`, instead of relying only on the Windows App SDK's transitive reference.

Windows CI smoke projects live in the repository-level `native-diagnostics/` folder, outside the WinUI host's default item discovery. Each smoke project and the shipping host pins the same WebView2 SDK version.

Windows Shell COM interop for Library backup dialogs is isolated in `WindowsShellFilePicker.cs`, outside the XAML-backed MainWindow partial class, so WinUI markup type discovery does not inspect COM-import declarations.


## Per-card private browsing

Native website cards can switch between the regular Nolane WebView2 profile and WebView2's temporary InPrivate mode. This uses WebView2 controller options instead of a visual-only privacy label.

For private cards, Nolane does not add visited URLs to browser history, does not allow bookmarks, does not persist download metadata, and keeps the live address only in memory rather than writing it into the workspace or its export. When leaving private mode, the card returns to its last saved regular-profile URL. Files a user explicitly saves through the native download dialog remain on disk; private mode does not delete user-selected files. An active or resumable download must finish or be canceled before that card can switch profiles. Nolane explicitly closes the underlying WebView2 controller when a card is evicted, deleted, or changes profiles; the private off-the-record profile is then released by WebView2. The UI shows a PRIVATE status label only after the host confirms the InPrivate controller is active.

## Multiple login profiles

Each native website card can use the Default, Work, Personal, Research or a custom named profile. A profile has its own persistent cookies, preferences and cache; cards assigned to the same profile share that login state. Profiles live under the same WebView2 user-data folder, avoiding a separate browser runtime for each account. A card's selected profile is saved with the workspace. Private Mode can be combined with a named profile, but its off-the-record browsing state is discarded when its controller is closed. Changing a profile recreates the card's controller; Nolane blocks this while a download is active or resumable.

The native host's Profiles manager lists profiles found in saved workspaces and the local Library. Clear browsing data and Delete profile each require their own confirmation. Clear removes cookies, cache, site storage, and that profile's Library History/Bookmarks, but keeps downloaded files and the Downloads list. Matching regular website cards reload immediately after a clear; suspended cards reload when they are brought back into view. Deleting a named profile is blocked while any card in any saved workspace references it or any browser surface remains open. WebView2 marks the profile for deletion and removes its directory when the browser process exits; restart Nolane before reusing the deleted name. The Default profile can be cleared but cannot be deleted.


## Windows background bridge

Run `Nolane.DesktopHost.exe` once. It moves to the notification area, starts with Windows after the first successful website connection, and does not open a separate workspace for daily use. Open the Nolane website in Chrome or Edge and choose **Connect Windows bridge** once. The browser asks for Loopback Network Access because a public HTTPS website is connecting to a local companion service; after approval, the site reconnects automatically.

The bridge binds only to IPv4 loopback (`127.0.0.1`), checks the exact Nolane website Origin, accepts one active workspace connection, and limits incoming text messages to 2 MiB. The transparent native overlay follows the browser viewport and is shaped to the visible website-card rectangles, so empty canvas areas pass pointer input through to the website. The overlay hides when the workspace tab is hidden or the browser loses foreground ownership.

The native WebView2 surfaces have their own cookies and sign-in profiles; Chrome cookies are not imported. Browser chrome insets, display scaling, multi-monitor moves, fullscreen and focus transitions still require hands-on validation on supported Windows/Chrome/Edge combinations. CI compilation and contract tests do not replace real desktop interaction tests.


## Background bridge validation boundary

Windows CI compiles and packages the real WinUI/WebView2 host and runs JavaScript contract tests. It does not exercise Chrome's native child HWND detection, DPI alignment, focus transitions or click-through behavior on a user's desktop. Those need a manual Windows 11 + Chrome/Edge validation pass before calling the overlay production-verified.


Windows background bridge download: [Nolane Native WebView2 Host (Windows x64)](https://github.com/Nolane-x/web-view/releases/download/native-latest/nolane-native-webview2-host-win-x64.zip). The stable asset is refreshed only after the native Windows workflow succeeds.
