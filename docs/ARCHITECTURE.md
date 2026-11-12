# Architecture and compatibility boundary

## Current application

The deployed site is a static HTML/CSS/JavaScript application. It stores the workspace snapshot locally in IndexedDB and uses localStorage only as a fallback. The service worker caches the static app shell; it does not proxy website traffic.

Website cards provide three paths:

1. **Safe Preview** loads the original URL in a sandboxed iframe without allow-same-origin. The opaque origin limits access to origin-bound storage and APIs, so some modern client applications can throw client-side exceptions in this mode.
2. **Compatibility Preview** is an explicit per-card opt-in. It adds allow-same-origin and allow-storage-access-by-user-activation so the site runs with its normal origin and can request storage access where the browser supports it. This may fix applications that fail in the opaque-origin sandbox, but it expands the security boundary. Users should enable it only for sites they trust. In particular, a frame that navigates back to the workspace's own origin could undermine the sandbox isolation; the feature is not a universal safe bypass.
3. **Open tab** opens the URL in the user's normal browser profile and is the most compatible route for signed-in services.

Neither preview mode can override CSP frame-ancestors or X-Frame-Options. Third-party cookie policy, Storage Access API grants, passkeys, anti-automation checks, popup flows and site-specific restrictions remain under the browser/site's control. The application cannot inspect the contents or console of a cross-origin iframe and therefore cannot reliably identify the exact reason a remote application failed.

## Browser Companion: future integration point

The optional MV3 companion is implemented in extension/. Its popup requests the optional Tabs permission only after an explicit user click, then lets the user select which open HTTP(S) tabs to import. It sends only selected tab IDs, window IDs, titles and URLs to the workspace. The content script bridges those messages only on the published GitHub Pages origin; the service worker can focus the selected original tab. Existing website sessions stay inside Chrome. The extension does not request cookies, debugger, history, webRequest, scripting or tab-capture permissions.

This companion is a tab handoff tool, not a live browser surface. It does not expose the original tab's DOM to the canvas and does not mirror its rendered page. A selected card can focus the actual Chrome tab; if its tab ID is stale after a browser restart or tab closure, the card falls back to opening the URL.

## Universal web surface research

The strongest candidate for genuine composited website surfaces is a local browser host:

- **Custom Chromium host:** investigate Chromium's internal Surface Embed / WebContents composition implementation. This is not a general public Chrome Extension API and requires owning/maintaining a browser build or privileged host.
- **Windows WebView2 Composition:** an officially supported native composition API. It owns its own user-data folder/profile; it does not automatically inherit the user's existing Chrome profile.
- **Isolated Web Apps / Controlled Frame:** a specialized platform, not a drop-in mechanism for a normal GitHub Pages site or standard Chrome extension.

These approaches can host real cross-origin pages without requiring the page to permit an ordinary iframe, but they still need a local runtime and do not guarantee every service's OAuth, passkey, DRM, anti-automation, popup or file workflow.

## Non-goals for the static release

- Reading Chrome's cookie database or extracting session tokens.
- Disabling browser same-origin protections.
- Proxying arbitrary websites through a server.
- Claiming every website can be embedded.
- Sending the user's workspace layout or notes to a remote service.

## Acceptance criteria for a future browser runtime

1. Each surface has an isolated and explicitly selected browser context.
2. Session persistence is local and transparent.
3. Popup, permission, file chooser, download and external-auth flows have defined host handling.
4. Surface focus, keyboard routing, accessibility and clipboard are tested.
5. CPU, RAM and GPU usage are benchmarked with 1, 2, 4, 8 and 16 live surfaces.
6. Paused/offscreen surfaces do not continue expensive rendering unnecessarily.
7. Security review confirms no cookies or credentials are exported to the workspace website or its hosting provider.
