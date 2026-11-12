# Nolane Browser Companion 0.2.0 — Live Chrome Surface

This release adds **Live Chrome Surface**. It does not try to load the remote website inside an iframe. Instead, it captures the actual active Chrome tab as a video-only stream and renders that stream on the Nolane canvas. Pointer and keyboard events on the canvas are sent back to that same source tab through Chrome DevTools Protocol (CDP).

## Install / replace the previous version

1. Download the latest repository ZIP from GitHub and extract it.
2. Open chrome://extensions.
3. Remove the old **Nolane Browser Companion** extension.
4. Enable Developer mode and choose **Load unpacked**.
5. Select the new repository's extension/ folder.
6. Keep https://nolane-x.github.io/web-view/ open in one Chrome tab and refresh it.
7. Open the website you want to place inside Nolane (for example YouPass) in a separate normal Chrome tab, and sign in there as usual.
8. While the website tab is active, click the Nolane Companion toolbar icon and choose **Stream this tab to Nolane**.
9. Return to the Nolane tab. The real page should appear as an interactive live surface. Click inside it to route pointer and keyboard input to the source tab.

The capture action must be started from the active source website tab. This is deliberate: Chrome's activeTab grant and tab capture are user-invoked capabilities. A background tab cannot be captured without an explicit user action.

## Powerful permission warning — read this before installing

Version 0.2.0 requires activeTab, tabCapture and **debugger**. Chrome will display strong permission warnings. In particular, its debugger permission can technically access the page debugger backend and read/change data on websites. tabCapture is also classified as broad access by Chrome's warning UI.

The implementation's intended path is narrower than the permission itself: the user starts capture from the currently active tab; the service worker records that source tab ID, the designated Nolane consumer-tab ID, the user's local browser-profile ID and the source origin; its CDP handler exposes only fixed viewport, mouse, keyboard and text-input operations. The code does not call the Cookies API, Network domain, DOM snapshot, response-body or page-storage APIs. The optional tabs permission remains separate and is only for listing/importing selected tab titles and URLs.

No capture stream, cookies, passwords, page HTML or screen image are uploaded to a server. The video-only stream is consumed directly by the designated Nolane workspace tab. There is no WebRTC relay, STUN/TURN service, remote proxy, external database or server-side browser. Only install this unpacked extension if you trust this repository's source code.

## What the live surface supports

- The actual Chrome-rendered page, including its existing session, origin, cookies and storage (they remain inside the original tab).
- Mouse movement, clicks, right-click, wheel scrolling and keyboard events forwarded through CDP.
- The source page remains a real browser page; the canvas displays a video/control mirror.
- Live surfaces are stopped when the source tab closes, capture ends, the debugger detaches, or the top-level origin changes.

## Known limitations

- This is not a native WebContents child. Video encoding/capture/decoding adds latency and consumes CPU/GPU resources. Start with one surface and benchmark before using several.
- Chrome debugger attachment can conflict with DevTools already open for the source tab. Close DevTools for that tab before connecting.
- Some websites may detect remote debugging or behave differently while attached.
- Browser-owned UI (address bar, permission prompts, file chooser, passkeys, some popup windows/download flows), protected DRM video and some OS-level dialogs cannot be fully represented in a video surface. Click **Focus source** to use them in the original tab.
- Chrome-only, minimum supported version 116. Protected pages such as chrome:// and Chrome Web Store pages cannot be streamed.
- Source tab must be active when you invoke the Companion. The stream can continue when you switch back to Nolane, but cannot be silently started on arbitrary background tabs.
- For a true native composited browser child, a future Windows host using WebView2 Composition Controller is a better architectural endpoint. Its profile is separate from Chrome and does not automatically inherit Chrome login sessions.
