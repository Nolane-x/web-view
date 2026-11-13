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

An iframe may still be blocked by CSP/X-Frame-Options, and sandboxed frames may break origin-bound storage. For real pages, use **Live Chrome Surface**: the companion captures the actual active Chrome tab, then streams its video directly into the workspace while forwarding pointer/keyboard input to that tab via CDP. This avoids iframe restrictions and preserves the source tab's existing session. It remains a video/control mirror rather than a native browser child; browser-owned dialogs, passkeys, file pickers and some popup/download flows still require focusing the source tab. See extension/README.md for the debugger permission disclosure and setup steps.

The optional Chrome MV3 Browser Companion is now included in extension/. It asks for the Tabs permission only after the user clicks its grant button, lets the user select open tabs, and adds their titles/URLs as workspace cards. Selecting a card focuses the original Chrome tab, so its existing login session stays in Chrome. The extension does not read cookies, passwords, page contents or tokens. It does not turn tabs into embedded DOM surfaces; universal authenticated surfaces still require a local browser runtime (for example a custom Chromium host or a native WebView host). See extension/README.md and docs/ARCHITECTURE.md.


## Install the optional Chrome companion

The companion is source code in the repository; it is not installed automatically by the website.

1. Download the repository ZIP from GitHub and extract it.
2. Open chrome://extensions, enable Developer mode, and choose **Load unpacked**.
3. Select the extracted extension/ folder.
4. Refresh the GitHub Pages workspace, open the extension popup, and grant the optional Tabs permission only if you want to import tabs.
5. Select the tabs you want to add. Their sessions remain in Chrome; imported cards can switch back to the original tabs.

See extension/README.md for exact steps and permission details. A packaged ZIP is also published at [downloads/nolane-browser-companion-0.2.13.zip](https://nolane-x.github.io/web-view/downloads/nolane-browser-companion-0.2.13.zip). The package is an unpacked-extension bundle: extract it and select its extension/ folder in chrome://extensions.

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

This is the first working static workspace release. It establishes the canvas, local data model and website-card experience. It is not yet a native multi-WebContents browser, and it does not claim universal embedding or Chrome-session transfer.


## Native Windows browser surfaces

For websites that cannot be reliably controlled through the Chrome video mirror, the repository now includes an optional Windows WebView2 host in desktop-host/. Open Nolane inside that desktop app. It overlays a real WebView2 browser control on each website card, aligned to the card's live canvas position. Mouse, keyboard, touch/scroll and page focus are handled by the embedded browser control itself; interaction is not sent through a video mirror.

The native host uses a dedicated shared WebView2 profile under the user's Local AppData folder. It does not import or reuse Chrome cookies. Sign in to sites once inside the native host. It keeps at most four visible website surfaces active at once and suspends off-screen surfaces to reduce resource use. Windows 11 normally includes the Evergreen WebView2 Runtime; the app reports a clear runtime error if it is missing. The Chrome Companion remains available for normal Chrome tabs and sessions.

Download the latest Windows host directly: [Nolane Native WebView2 Host (Windows x64)](https://github.com/Nolane-x/web-view/releases/download/native-latest/nolane-native-webview2-host-win-x64.zip). The rolling release asset is updated only after a successful build. You can also download the CI artifact from the Build Native WebView2 Host workflow. This is a separate Windows application; a static GitHub Pages page in normal Chrome cannot create native WebView2 child controls by itself.

The native host hides its browser overlays while workspace dialogs or the mobile sidebar are open, and coalesces surface-layout updates so rapid panning/zooming cannot build a stale message backlog or spawn duplicate WebView2 controls. Its workspace message channel uses an explicit handshake rather than relying only on a one-shot page-load event.

Native WebView2 intentionally leaves Chrome-imported cards and active Companion live streams untouched. Those cards continue to use their original Chrome session; standalone website cards use the separate persistent WebView2 profile.

The Windows host has its own WebView2 browser profile, including the workspace's IndexedDB/localStorage. To move your current canvas from Chrome, export the workspace JSON in Chrome and import it after opening the Windows host; then sign in to the websites inside WebView2. Imported cards that still carry old Chrome tab IDs are treated as normal native website cards unless the Companion is currently connected to the matching Chrome profile.

When an exported Chrome workspace is imported in the native host, old Chrome-only tab IDs are cleared because the native host cannot access the Chrome profile. Their saved URLs become normal native website cards; you sign in again in the WebView2 profile.

Native browser controls are clipped to the live canvas viewport, so dragging a card across the workspace edge cannot make a child browser cover the sidebar or top bar.
