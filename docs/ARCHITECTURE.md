# Architecture and compatibility boundary

## Static workspace

The published website is a static HTML/CSS/JavaScript application. It stores workspace snapshots locally in IndexedDB with localStorage fallback. The service worker caches only the workspace shell; it does not proxy website traffic.

## Website display modes

A conventional iframe can be blocked by CSP frame-ancestors or X-Frame-Options. A restrictive opaque-origin sandbox can also break applications that require origin-bound storage, service workers, IndexedDB or authentication APIs. Compatibility sandboxing expands the trust boundary and still cannot override a host's anti-framing policy.

The reliable immediate path is **Live Chrome Surface** in Browser Companion v0.2. It operates on the user's real Chrome tab rather than creating a second embedded browsing context.

## Live Chrome Surface (MV3 companion v0.2)

The extension uses a tab-scoped capture/control pipeline:

1. The user opens a website in a normal Chrome tab, opens the Companion action from that active tab, and explicitly starts the stream.
2. The service worker verifies that the workspace is already open and records its tab ID.
3. chrome.debugger.attach establishes a CDP session to the selected source tab. Page.getLayoutMetrics obtains the CSS viewport dimensions used for pointer coordinate mapping.
4. chrome.tabCapture.getMediaStreamId creates a one-use video stream token with targetTabId set to the active website tab and consumerTabId bound to the exact Nolane workspace tab.
5. The workspace page consumes the token with getUserMedia using Chrome's chromeMediaSource: tab constraints, then displays the MediaStream in a video element inside the website card.
6. Pointer, wheel and keyboard events inside that card are sent to the workspace content script and service worker.
7. The service worker checks the active session ID, browser-profile ID, workspace sender tab ID, source tab ID and source origin, then sends only fixed Input.dispatchMouseEvent, Input.dispatchKeyEvent or Input.insertText commands via CDP.

The capture stream includes audio and video. The workspace routes audio through a local AudioContext and keeps it muted until the user explicitly enables sound, so tab audio is not captured and the source page's audio is not muted by the extension. There is no signaling server, WebRTC relay, external proxy, server-side browser or upload of frames. The source tab remains the actual page with its real cookies, storage and origin; the canvas is a live video/control mirror, not a DOM clone.

### Permission and security boundary

The companion declares activeTab, tabCapture and debugger; tabs remains optional for the separate tab-list/import feature. Chrome's warning for debugger is intentionally strong: the permission technically provides powerful access to the page debugger backend and can read/change website data. This must not be treated as a low-privilege bookmark extension.

The code deliberately does not expose a generic CDP command bridge and does not call the Cookies, Network, response-body, DOM snapshot or page-storage APIs. Live messages are accepted only from the exact registered Nolane workspace tab, and each source tab is bound to a browser profile ID and expected top-level origin. The stream token is scoped to the designated workspace consumer tab and is one-use/short-lived. Only install the unpacked extension if the repository source is trusted.

### Limitations

- Chrome debugger attachment can conflict with DevTools already open for that target. Close DevTools before streaming.
- The source page may detect remote debugging or behave differently while attached.
- Browser-owned UI (address bar, permission prompts, file chooser, passkeys, some popup/download flows), DRM-protected video and OS-level dialogs cannot be mirrored as normal page content; focus the source tab for those flows.
- Capturing and decoding video consumes CPU/GPU resources. The extension limits a workspace to three concurrent live surfaces; saved cards can be unlimited within the workspace's normal node cap.
- Chrome-only; minimum supported version is 116.
- Each source tab must be explicitly streamed while it is active. It is not a silent background-tab capture tool.

## Native Windows browser host: long-term endpoint

For a true composited browser child, the strongest documented Windows route is WebView2 Composition Controller. It combines a real WebView2 surface with the native visual tree and exposes mouse/pointer/focus APIs. It avoids iframe anti-framing headers and video-mirror latency, but WebView2 uses its own user-data folder/profile; it does not automatically inherit Chrome cookies. A native host is a separate Windows desktop application, not something a static GitHub Pages website or MV3 extension can become by itself.

## Non-goals

- Reading Chrome's cookie database or extracting session tokens.
- Disabling browser same-origin protections.
- Proxying arbitrary websites through an external service.
- Claiming universal support for site-specific passkey, DRM or browser-owned UI flows.
- Uploading the user's workspace, notes or captured page frames to remote services.
