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

See extension/README.md for exact steps and permission details. A packaged ZIP is also published at [downloads/nolane-browser-companion-0.2.0.zip](https://nolane-x.github.io/web-view/downloads/nolane-browser-companion-0.2.0.zip). The package is an unpacked-extension bundle: extract it and select its extension/ folder in chrome://extensions.

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
