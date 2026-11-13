# Architecture and compatibility boundary

## Static workspace

The published website is a static HTML/CSS/JavaScript application. It stores workspace snapshots locally in IndexedDB with localStorage fallback. The service worker caches only the workspace shell; it does not proxy website traffic.

## Website display modes

A conventional iframe can be blocked by CSP frame-ancestors or X-Frame-Options. A restrictive opaque-origin sandbox can also break applications that require origin-bound storage, service workers, IndexedDB or authentication APIs. Compatibility sandboxing expands the trust boundary and still cannot override a host's anti-framing policy.

The reliable immediate path is **Live Chrome Surface** in Browser Companion v0.2.8. It operates on the user's real Chrome tab rather than creating a second embedded browsing context.

## Live Chrome Surface (MV3 companion v0.2.8)

The extension uses a tab-scoped capture/control pipeline:

1. The user opens a website in a normal Chrome tab, opens the Companion action from that active tab, and explicitly starts the stream.
2. The service worker verifies that the workspace is already open and records its tab ID.
3. The service worker attempts chrome.debugger.attach as an optional input-control capability. When available, Page.getLayoutMetrics obtains the CSS viewport dimensions used for pointer coordinate mapping. A debugger failure (including Chromium's foreign-extension-frame restriction) does not abort capture; the surface continues in clearly labelled view-only mode.
4. Before creating a stream, the service worker checks chrome.tabCapture.getCapturedTabs() and reports an already-pending/active capture instead of attempting a duplicate. By default it moves the existing Nolane tab into a separate Chrome window with chrome.windows.create({tabId, focused: true}), leaving the source tab selected in its original window. The user can disable this behavior in the popup. It then calls chrome.tabCapture.getMediaStreamId with targetTabId set to the active website tab and consumerTabId bound to the workspace tab. The token is delivered immediately because it is one-use and short-lived.
5. The workspace page consumes the token with getUserMedia using Chrome's chromeMediaSource: tab constraints, then acknowledges only after its video element has decoded a real frame.
6. Pointer, wheel and keyboard events inside that card are sent to the workspace content script and service worker.
7. When CDP is available, the service worker checks the active session ID, browser-profile ID, exact workspace sender origin and tab ID, source tab ID and source origin, then sends only fixed Input.dispatchMouseEvent, Input.dispatchKeyEvent or Input.insertText commands via CDP. In view-only mode the input route is disabled and the card tells the user to focus the original tab.
8. Page.frameResized events trigger a debounced Page.getLayoutMetrics refresh; the new CSS viewport dimensions are sent back to the canvas so pointer mapping remains correct when Chrome is resized.

The capture stream includes audio and video. The workspace routes audio through a local AudioContext and keeps it muted until the user explicitly enables sound, so tab audio is not captured and the source page's audio is not muted by the extension. There is no signaling server, WebRTC relay, external proxy, server-side browser or upload of frames. The source tab remains the actual page with its real cookies, storage and origin; the canvas is a live video/control mirror, not a DOM clone.

On sufficiently wide normal source windows, the workspace window is positioned over the right portion of the source window to leave both surfaces partly visible without resizing the source page. Smaller/maximized windows use Chrome's default window placement.
On the first 12-second no-frame timeout, the workspace performs one soft recovery: it detaches and reattaches the existing MediaStream to the local video element, awaits a decoded frame, then re-arms the frame callback monitor. The manual **Refresh video** action uses the same path, with a three-attempt/five-minute limit. A failed soft recovery reattaches the original stream before reporting the failure; it never creates another capture token or changes the source website's session.

The popup also exposes a local Website Compatibility Engine. It classifies the active tab from origin/path heuristics, diagnoses Chrome capture and media failures, and recommends an action based on track/capture state. A local origin-keyed history tracks attempts, successes, failures and health transitions, capped at 40 website origins. The analyzer never reads page DOM, cookies, response bodies, screenshots or URL query strings.
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

## Native Windows browser host: long-term endpoint

For a true composited browser child, the strongest documented Windows route is WebView2 Composition Controller. It combines a real WebView2 surface with the native visual tree and exposes mouse/pointer/focus APIs. It avoids iframe anti-framing headers and video-mirror latency, but WebView2 uses its own user-data folder/profile; it does not automatically inherit Chrome cookies. A native host is a separate Windows desktop application, not something a static GitHub Pages website or MV3 extension can become by itself.

## Non-goals

- Reading Chrome's cookie database or extracting session tokens.
- Disabling browser same-origin protections.
- Proxying arbitrary websites through an external service.
- Claiming universal support for site-specific passkey, DRM or browser-owned UI flows.
- Uploading the user's workspace, notes or captured page frames to remote services.
