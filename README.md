# Nolane Infinite

**A personal web workspace, not another bookmark page.**

Nolane Infinite is a local-first canvas for arranging websites, ideas and tools in one visual space.

🌐 **GitHub Pages:** https://nolane-x.github.io/web-view/

## What works today

- Infinite canvas with pointer-based pan and cursor-anchored zoom.
- Website cards with direct open-in-browser and an optional embedded-view attempt.
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

A website can refuse iframe embedding through CSP frame-ancestors or X-Frame-Options. Third-party cookie restrictions can also affect embedded sessions. When that happens, use **Open tab** to visit the original website in the user's normal browser profile.

The optional Chrome MV3 Browser Companion is now included in extension/. It asks for the Tabs permission only after the user clicks its grant button, lets the user select open tabs, and adds their titles/URLs as workspace cards. Selecting a card focuses the original Chrome tab, so its existing login session stays in Chrome. The extension does not read cookies, passwords, page contents or tokens. It does not turn tabs into embedded DOM surfaces; universal authenticated surfaces still require a local browser runtime (for example a custom Chromium host or a native WebView host). See extension/README.md and docs/ARCHITECTURE.md.

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
