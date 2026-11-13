# Nolane Native WebView2 Host

This optional Windows 11 desktop host opens the existing Nolane Infinite GitHub Pages workspace and overlays real WebView2 controls over website-card bodies.

## Why this exists

A normal static website cannot create native browser children. The Chrome Companion mirrors a real Chrome tab with tabCapture and sends CDP input commands; that is useful when the user must retain an existing Chrome login, but Chrome may deny debugger attachment. This host uses WebView2 controls directly in the WinUI 3 visual tree, so the site receives native browser input without a video-mirror/CDP input round-trip.

## Build

The latest self-contained Windows x64 build is available at [Nolane Native WebView2 Host](https://github.com/Nolane-x/web-view/releases/download/native-latest/nolane-native-webview2-host-win-x64.zip). It is also published as a GitHub Actions artifact from the Build Native WebView2 Host workflow. The workflow builds a self-contained x64 unpackaged WinUI 3 app:

1. Download the nolane-native-webview2-host-win-x64 artifact from the latest successful run.
2. Extract the ZIP.
3. Run Nolane.DesktopHost.exe.

The app requires the Microsoft Edge WebView2 Evergreen Runtime. Windows 11 normally has this runtime installed; install the Evergreen Runtime from Microsoft if the app reports that it is missing.

## How it works

- The parent WebView2 opens https://nolane-x.github.io/web-view/.
- The parent page sends a versioned layout snapshot of website card bodies over chrome.webview.postMessage.
- The native host validates the source origin/path and creates one child WebView2 control for each visible website card.
- Child controls share a dedicated profile folder in %LOCALAPPDATA%\Nolane\NativeWebView2\UserData. Website logins persist between app launches and across cards in the host.
- Up to four visible surfaces remain active at once. Off-screen controls are hidden/suspended; a bounded cache releases stale browser views.
- The host does not read Chrome cookies, browser passwords, Chrome tabs or page storage. Native host website logins are separate from Chrome's profile.

## Current boundaries

This is an initial native-surface integration, not a replacement for all Chrome browser UI. Chrome-owned passkeys and extensions are not inherited. Some popup or download flows may open in separate windows or the system browser. Browser permission prompts remain controlled by WebView2. Use the Chrome Companion if an already-authenticated Chrome tab is required.


## Browser controls, permissions and runtime

Native cards expose per-site Back, Forward, Reload and Mute controls. Active page URLs and history/audio state are synced to the canvas. The host checks for the Evergreen WebView2 Runtime and reports updates that require a restart. Privileged WebView2 permissions use an explicit native Allow once/Block dialog and are not persisted. Downloads retain the WebView2 native save dialog. Unsolicited popups are blocked; user-initiated popups open externally.


## Adaptive resource limits and renderer recovery

The number of visible websites adapts to the runtime memory budget: at most 2 on systems reporting 10 GiB or less, 3 up to 16 GiB, and 4 above 16 GiB. Hidden surfaces are suspended and the cached-control limit is twice the active limit (up to 8). Renderer crashes trigger one bounded automatic reload per two-minute window; repeated crashes and unresponsive pages require an intentional manual Reload. GPU and utility process exits are left to WebView2's automatic recovery. A shared browser-process exit requires restarting the host.
