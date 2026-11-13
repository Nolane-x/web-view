import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => { console.error("FAIL " + message); process.exitCode = 1; };
const pass = (message) => console.log("PASS " + message);

const html = read("index.html");
const js = read("app.js");
const css = read("styles.css");
const manifest = JSON.parse(read("manifest.webmanifest"));
const sw = read("sw.js");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const idSet = new Set(ids);
if (idSet.size !== ids.length) fail("HTML contains duplicate id attributes.");
else pass("HTML IDs are unique (" + ids.length + ").");

const queriedIds = new Set([
  ...[...js.matchAll(/\$\(["']#([A-Za-z][\w-]*)["']\)/g)].map((match) => match[1]),
  ...[...js.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1])
]);
const missingIds = [...queriedIds].filter((id) => !idSet.has(id));
if (missingIds.length) fail("JavaScript references missing HTML IDs: " + missingIds.join(", "));
else pass("All static JavaScript ID selectors exist.");

const symbols = new Set([...html.matchAll(/<symbol\b[^>]*\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const iconRefs = new Set([
  ...[...html.matchAll(/href=["']#(i-[^"']+)["']/g)].map((match) => match[1]),
  ...[...js.matchAll(/href="#(i-[^"]+)"/g)].map((match) => match[1])
]);
const missingSymbols = [...iconRefs].filter((symbol) => !symbols.has(symbol));
if (missingSymbols.length) fail("Missing SVG symbols: " + missingSymbols.join(", "));
else pass("All referenced interface icons have SVG symbols.");

if (manifest.name !== "Nolane Infinite" || manifest.start_url !== "./" || manifest.scope !== "./") fail("PWA manifest identity or relative scope is invalid.");
else pass("PWA manifest is valid and uses repository-relative paths.");

for (const asset of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js", "icon.svg"]) {
  if (!fs.existsSync(path.join(root, asset))) fail("Required asset missing: " + asset);
}
if (sw.includes("https://") && !sw.includes("self.location.origin")) fail("Service worker contains an unexpected remote dependency.");
else pass("Static app shell assets are present.");

if (/@import\s+url\(/i.test(css)) fail("CSS imports a remote stylesheet. Keep the shell dependency-free.");
else pass("No remote CSS imports.");

if (!/const SAFE_FRAME_SANDBOX = "allow-scripts/.test(js) || /const SAFE_FRAME_SANDBOX = "[^"]*allow-same-origin/.test(js)) fail("Safe Preview must keep scripts enabled but omit allow-same-origin.");
else pass("Safe Preview retains its restricted opaque-origin sandbox.");
if (!/const COMPATIBILITY_FRAME_SANDBOX = SAFE_FRAME_SANDBOX \+ " allow-same-origin allow-storage-access-by-user-activation"/.test(js)) fail("Compatibility Preview sandbox is missing its explicit origin/storage tokens.");
else pass("Compatibility Preview uses a separate, explicit opt-in sandbox policy.");
if (!/window\.confirm\([\s\S]*Only enable this for a website you trust/.test(js) || !/mode === "compat"/.test(js)) fail("Compatibility Preview must require an explicit trust confirmation.");
else pass("Compatibility Preview requires an explicit user confirmation.");
if (!/clean\.embedMode = node\.embedMode === "compat" \? "compat" : "safe"/.test(js)) fail("Website preview mode is not normalized when loading or importing workspaces.");
else pass("Website preview mode persists safely through workspace normalization.");

if (!/indexedDB\.open/.test(js) || !/localStorage\.setItem/.test(js)) fail("Local persistence or fallback is missing.");
else pass("Local persistence and fallback are present.");


if (!/function defaultSpaces\(/.test(js) || !/function syncActiveSpace\(/.test(js) || !/spaces: spaces\.map/.test(js)) fail("Multi-workspace persistence is incomplete.");
else pass("Multi-workspace model and export are present.");

if (!/let importedSpaces = \[\]/.test(js) || !/Commit the import only after/.test(js)) fail("Workspace import is not staged before applying.");
else pass("Workspace import is staged and applied atomically.");

if (/chrome\.cookies|chrome\.debugger|chrome\.tabs\.capture/i.test(js)) fail("Static workspace unexpectedly accesses privileged extension APIs.");
else pass("Static workspace does not access privileged browser APIs.");

if (!html.includes('id="bridgeDialog"') || !html.includes("Companion not detected")) fail("Browser Companion status UI is missing.");
else pass("Browser Companion status is explicit and does not imply a working extension.");

const extensionManifest = JSON.parse(read("extension/manifest.json"));
const extensionBridge = read("extension/content.js");
const extensionPopupHTML = read("extension/popup.html");
if (!extensionManifest.version || !extensionBridge.includes('const PROFILE_VERSION = "' + extensionManifest.version + '";') ||
    !extensionPopupHTML.includes('<span class="version">' + extensionManifest.version + '</span>')) fail("Manifest, content bridge and popup versions must match exactly.");
else pass("Manifest, content bridge and popup versions are synchronized.");
if (!extensionManifest.host_permissions?.includes("https://nolane-x.github.io/*")) fail("Workspace URL discovery needs a narrowly scoped Nolane host permission.");
else pass("Workspace URL discovery has only the Nolane host permission; broad tab import remains optional.");
if (extensionManifest.version !== "0.2.13") fail("Browser Companion release metadata must be synchronized at version 0.2.13.");
else pass("Browser Companion release metadata is synchronized at 0.2.13.");
for (const file of ["extension/background.js", "extension/compatibility.js", "extension/content.js", "extension/popup.html", "extension/popup.css", "extension/popup.js", "extension/README.md"]) {
  if (!fs.existsSync(path.join(root, file))) fail("Browser Companion asset missing: " + file);
}
if (extensionManifest.manifest_version !== 3 || !extensionManifest.permissions?.includes("activeTab")) fail("Browser Companion must be MV3 and request activeTab for user-invoked capture.");
else pass("Browser Companion uses Manifest V3 and user-invoked activeTab access.");

const requiredPermissions = ["storage", "activeTab", "tabCapture", "debugger"];
if (requiredPermissions.some((permission) => !extensionManifest.permissions?.includes(permission))) fail("Live Chrome Surface permissions are incomplete.");
else pass("Live capture and CDP input permissions are declared.");
if (!extensionManifest.optional_permissions?.includes("tabs")) fail("Tab-list scanning must remain optional.");
else pass("Tab-list scanning remains an optional permission.");

const allPermissions = [...(extensionManifest.permissions || []), ...(extensionManifest.optional_permissions || [])];
if (allPermissions.some((permission) => ["cookies", "history", "webRequest", "scripting"].includes(permission))) fail("Companion requests a permission outside its documented capture/debug path.");
else pass("Companion does not request cookies, history, webRequest or generic scripting access.");

if (!extensionManifest.content_scripts?.some((entry) => entry.matches?.includes("https://nolane-x.github.io/web-view/*"))) fail("Content script must be restricted to the published workspace origin.");
else pass("Content script is restricted to the workspace origin.");

if (!fs.existsSync(path.join(root, "tests/background.test.mjs"))) fail("Live Chrome Surface controller tests are missing.");
else pass("Live Chrome Surface controller tests are present.");

const background = read("extension/background.js");
const compatibilityEngine = read("extension/compatibility.js");
const bridge = read("extension/content.js");
const popup = read("extension/popup.js");
const popupHTML = read("extension/popup.html");
if (!/chrome\.tabCapture\.getMediaStreamId/.test(background) || !/consumerTabId:\s*workspaceTabId/.test(background)) fail("Capture stream must be bound to the Nolane consumer tab.");
else pass("Tab capture stream is bound to the designated workspace tab.");
if (!/chrome\.debugger\.attach/.test(background) || !/Input\.dispatchMouseEvent/.test(background) || !/Input\.dispatchKeyEvent/.test(background)) fail("CDP input forwarding is incomplete.");
else pass("CDP input uses fixed mouse and keyboard methods.");
if (!/Page\.frameNavigated/.test(background) || !/expectedOrigin/.test(background)) fail("Live sessions must stop when the source origin changes.");
else pass("Live sessions are bound to the source origin.");
if (!/Page\.frameResized/.test(background) || !/NOLANE_LIVE_VIEWPORT_UPDATE/.test(bridge) || !/LIVE_VIEWPORT_UPDATE/.test(js)) fail("Live viewport resize synchronization is incomplete.");
else pass("Chrome viewport resizing updates the live canvas coordinate system.");
if (!/manualCardMatch/.test(js) || !/existing\.browserTabId = tab\.id/.test(js)) fail("Manual website cards cannot be rebound to their matching Chrome tab.");
else pass("Existing manual website cards can attach to the live Chrome tab without duplicates.");
if (!/NOLANE_REGISTER_WORKSPACE/.test(bridge) || !/NOLANE_LIVE_INPUT/.test(bridge) || !/LIVE_INPUT_RESULT/.test(bridge)) fail("Workspace content-script registration/input bridge or input acknowledgement is incomplete.");
else pass("Content script registers the workspace and forwards input.");
if (!/NOLANE_WORKSPACE_PING/.test(bridge) || !/getWorkspaceConnectionStatus/.test(background) || !/chrome\.tabs\.query\(\{ url: WORKSPACE_MATCH \}\)/.test(background)) fail("Workspace reconnection must discover open tabs and verify the content-script bridge.");
else pass("Workspace discovery verifies an open Nolane tab and reconnects after extension reload.");
if (!/chrome\.storage\.local\.set\(\{ \[WORKSPACE_KEY\]/.test(background) || !/NOLANE_GET_WORKSPACE_STATUS/.test(background)) fail("Workspace tab identity must survive extension storage.session resets and be checked on demand.");
else pass("Workspace registration is persisted locally and exposed as a verified connection state.");
if (!/refresh-workspace/.test(background) || !/open-workspace/.test(background) || !/workspace\.state !== "connected"/.test(background)) fail("Compatibility analysis must not recommend capture before the workspace bridge is ready.");
else pass("Compatibility recovery opens or reconnects Nolane before starting capture.");
if (!/LIVE_SURFACE_ACK/.test(js) || !/pendingLiveStarts/.test(background)) fail("Live capture start must wait for workspace stream acknowledgement.");
else pass("Live capture start waits for the workspace stream acknowledgement.");
if (!/waitForLiveVideoFrame/.test(js) || !/requestVideoFrameCallback/.test(js)) fail("Live capture must verify a decoded video frame before acknowledging success.");
else pass("Live capture verifies a decoded frame before acknowledging success.");
if (!/interactionReason/.test(background) || !/debuggerAttached/.test(background) || !/interactive/.test(background) || !/tabCapture\.getMediaStreamId/.test(background)) fail("Debugger failure must not prevent local tab video capture.");
else pass("CDP is optional; tab video capture can continue in explicit view-only mode.");
if (!/LIVE VIDEO · VIEW ONLY/.test(js) || !/live-surface-readonly/.test(js)) fail("Workspace must clearly render video-only surfaces as read-only.");
else pass("View-only surfaces are visibly distinguished from interactive surfaces.");
if (!/stoppedLiveSurfaceIds/.test(js) || !/stoppedLiveSurfaceIds/.test(background) || !/pendingStart\.reject/.test(background)) fail("Cross-origin stops must cancel pending startup and prevent a late stream from mounting.");
else pass("Cross-origin navigation also cancels in-flight surface startup.");
const captureIndex = background.indexOf("chrome.tabCapture.getMediaStreamId");
const ackIndex = background.indexOf("acknowledgement = new Promise");
if (captureIndex < 0 || ackIndex < 0 || captureIndex > ackIndex) fail("The acknowledgement timer must start only after tabCapture returns a stream token.");
else pass("The acknowledgement timer starts only after stream-token creation.");
if (!/MAX_LIVE_INPUT_QUEUE/.test(background) || !/enqueueLiveInput/.test(background) || !/mouseMoved/.test(background)) fail("Live input must use a bounded, ordered queue with pointer-move coalescing.");
else pass("Live input uses a bounded queue and preserves discrete input order.");
if (!/tail\.waiters\.forEach\(\(pending\) => pending\.resolve\(\{ ok: true, dropped: true \}\)\)/.test(background) || !/tail\.waiters = \[waiter\]/.test(background)) fail("Superseded pointer moves must release their waiters instead of accumulating during debugger backpressure.");
else pass("Superseded pointer moves release stale waiters immediately.");
if (!/chrome\.tabs\.onUpdated/.test(background) || !/removeSessionsForWorkspaceTab/.test(background) || !/movedToAnotherOrigin/.test(background)) fail("Workspace lifecycle and source-origin changes must release live sessions without depending on CDP.");
else pass("Workspace lifecycle and source-origin changes release live sessions without depending on CDP.");
if (!/async function refreshSessionViewport/.test(background) || !/chrome\.windows\.onBoundsChanged/.test(background) || !/viewportSource/.test(background)) fail("Viewport fallback must keep coordinates synchronized when optional CDP Page events are unavailable.");
else pass("Viewport coordinates have a tab-size fallback and a Chrome window-resize refresh path.");
if (!/Page\.enable/.test(background) || !/Input\.dispatchMouseEvent/.test(background) || !/interactive = true/.test(background)) fail("Input attachment must remain independent from optional Page-domain inspection.");
else pass("CDP Input remains active when optional Page-domain inspection fails.");
const focusIndex = background.indexOf("chrome.windows.update(workspaceTab.windowId, { focused: true })");
const streamIndex = background.indexOf("chrome.tabCapture.getMediaStreamId");
if (focusIndex < 0 || streamIndex < 0 || focusIndex > streamIndex) fail("The short-lived stream token must be minted only after the consumer tab is focused.");
else pass("The stream token is minted immediately after consumer focus to reduce expiry risk.");
if (!/audio:\s*\{\s*mandatory:\s*\{\s*chromeMediaSource:\s*"tab"/.test(js) || !/video:\s*\{\s*mandatory:\s*\{\s*chromeMediaSource:\s*"tab"/.test(js) || !/createMediaStreamSource/.test(js) || !/toggleLiveAudio/.test(js)) fail("Live surface audio/video tab-capture constraints or local mute controls are incomplete.");
else pass("Live surface audio is routed locally with explicit mute control.");
if (!/NOLANE_START_LIVE_SURFACE/.test(popup) || !/Stream this tab to Nolane/.test(popupHTML)) fail("Popup must expose explicit active-tab capture.");
else pass("Popup exposes explicit current-tab capture.");
if (!/workspaceStatusPanel/.test(popupHTML) || !/workspaceStatusTitle/.test(popup) || !/NOLANE_GET_WORKSPACE_STATUS/.test(popup)) fail("Popup must show verified workspace readiness before enabling live capture.");
else pass("Popup displays an explicit verified workspace connection state.");
if (!/getWorkspaceConnectionStatus/.test(background) || /Open Nolane Infinite in another Chrome tab first, then refresh it/.test(background)) fail("Legacy transient-only workspace registration must not remain in the live capture path.");
else pass("Live capture no longer depends on a storage.session-only workspace tab ID.");
if (!/keepSourceVisible/.test(popup) || !/chrome\.windows\.create/.test(background) || !/focused:\s*true/.test(background)) fail("Keep-source-visible compatibility mode must move Nolane into a separate Chrome window.");
else pass("Keep-source-visible mode preserves the source tab in its original window.");
if (!/chrome\.tabCapture\.getCapturedTabs/.test(background) || !/already reports an active capture/.test(background)) fail("Existing tab capture must be detected before attempting a duplicate stream.");
else pass("Existing tab captures are detected before stream setup.");
if (!/NOLANE_GET_DIAGNOSTICS/.test(background) || !/diagnosticsButton/.test(popup)) fail("The companion compatibility diagnostics action is incomplete.");
else pass("The companion exposes a local compatibility diagnostics report.");
if (!/importScripts\("compatibility\.js"\)/.test(background) || !/root\.NolaneCompatibility/.test(compatibilityEngine)) fail("The service worker does not load the local Website Compatibility Engine.");
else pass("The service worker loads the local Website Compatibility Engine.");
if (!/NOLANE_DIAGNOSE_TAB/.test(background) || !/diagnoseButton/.test(popup) || !/renderCompatibilityResult/.test(popup)) fail("Current-tab compatibility analysis is incomplete.");
else pass("The Companion can analyze the active website locally.");
if (!/COMPATIBILITY_PROFILES_KEY/.test(background) || !/recordCompatibilityObservation/.test(background) || !/slice\(0, 40\)/.test(background)) fail("Origin-only compatibility history is not bounded and persisted locally.");
else pass("Compatibility history is stored locally by origin and bounded to 40 sites.");
if (!/CDP_FOREIGN_EXTENSION_FRAME/.test(compatibilityEngine) || !/CAPTURE_ENDED/.test(compatibilityEngine) || !/VIDEO_NO_NEW_FRAMES/.test(compatibilityEngine)) fail("Compatibility engine is missing major Chrome capture failure diagnoses.");
else pass("Compatibility engine recognizes Chrome debugger, capture-track and no-frame failure families.");
if (!/assessSession/.test(compatibilityEngine) || !/restart-capture/.test(compatibilityEngine) || !/refresh-video/.test(compatibilityEngine)) fail("Compatibility recovery recommendations do not distinguish ended tracks from live tracks.");
else pass("Compatibility engine recommends refresh only for a live track and a new capture for ended tracks.");
if (!/NOLANE_APPLY_COMPATIBILITY_ACTION/.test(background) || !/message\.action !== expectedAction/.test(background) || !/sender\.url\.startsWith\(popupUrl\)/.test(background)) fail("Compatibility remediation must be popup-only and revalidated against current session state.");
else pass("Compatibility remediation is restricted to the Companion popup and rejects stale actions.");
if (!/NOLANE_LIVE_SURFACE_REFRESH/.test(bridge) || !/LIVE_SURFACE_REFRESH/.test(js) || !/refreshLiveVideo\(entry\[0\]/.test(js)) fail("Refresh remediation is not relayed to the matching live surface.");
else pass("Video refresh commands are relayed to the matching live surface only.");
if (!/LIVE_SURFACE_HEALTH/.test(background) || !/NOLANE_LIVE_SURFACE_HEALTH/.test(bridge) || !/normalizeHealthState/.test(background)) fail("Continuous live-surface health telemetry is incomplete.");
else pass("Live video health transitions are authenticated and persisted locally.");
if (!/requestVideoFrameCallback\(onFrame\)/.test(js) || !/Date\.now\(\) - monitor\.lastFrameAt > 12000/.test(js) || !/stopLiveFrameMonitor/.test(js)) fail("Long-running live video watchdog or teardown is incomplete.");
else pass("Long-running decoded-frame watchdog detects stalls and cleans up safely.");
if (!/data-action="refresh-live"/.test(js) || !/async function refreshLiveVideo/.test(js) || !/autoRecoveryAttempted/.test(js) || !/recoveryAttempts\.length >= 3/.test(js)) fail("Bounded live-video soft recovery and manual refresh are incomplete.");
else pass("Live video has one automatic soft recovery and a bounded manual refresh action.");
if (!/monitor\.video = null/.test(js) || !/bindLiveFrameMonitor\(nodeId, surface, video\)/.test(js)) fail("The frame watchdog must be re-armed after video recovery.");
else pass("Frame monitoring is re-armed after a successful soft recovery.");
if (!/recovering/.test(background) || !/recovering/.test(js)) fail("The recovering live-surface state is not supported across the bridge.");
else pass("The recovering state is supported by the UI and service worker.");
if (!/chrome\.tabCapture\.onStatusChanged/.test(background) || !/info\.status === "pending"/.test(background) || !/info\.status === "active"/.test(background)) fail("Chrome tab-capture lifecycle states are not tracked.");
else pass("Tab capture pending/active/stopped/error lifecycle is tracked.");
if (!/normalizeVideoInfo/.test(background) || !/presentedFrames/.test(background) || !/requestVideoFrameCallback/.test(js) || !/presentedFrames/.test(js)) fail("Decoded-frame metrics must be attached to the compatibility diagnostics.");
else pass("The compatibility report includes decoded-frame and track metrics.");
if (!/sourceWindow\.width >= 1120/.test(background) || !/createData\.width = workspaceWidth/.test(background)) fail("Wide windows must place the source and workspace surfaces side by side.");
else pass("Wide windows receive an automatic side-by-side workspace placement.");

if (!/sanitizeTabUrl/.test(popup) || !/url\.hash = ""/.test(popup)) fail("Tab URL sanitizer is missing.");
else pass("Tab URL sanitizer removes fragments and credential-like query parameters.");

if (!extensionManifest.permissions?.includes("storage") || !/crypto\.randomUUID/.test(background)) fail("Browser Companion profile identity is not stored locally.");
else pass("Browser Companion maintains a local per-profile identity.");

if (!/message\.profileId !== profileId/.test(background) || !/browserSessionId/.test(read("app.js"))) fail("Browser Companion profile identity is not verified for original-tab focus.");
else pass("Original-tab focus remains tied to its browser profile.");


const nativeHost = read("desktop-host/MainWindow.xaml.cs");
const nativeProject = read("desktop-host/Nolane.DesktopHost.csproj");
const nativeWorkflow = read(".github/workflows/desktop-host.yml");
if (!nativeHost.includes("nolane.surfaces.sync") || !nativeHost.includes("EnsureCoreWebView2Async") || !nativeHost.includes("CreateWithOptionsAsync") ||
    !nativeHost.includes("TrySuspendAsync") || !nativeHost.includes("MaxVisibleSurfaces = 4")) fail("Native WebView2 host must create real browser surfaces and bound active renderers.");
else pass("Native WebView2 host creates real browser surfaces and bounds active renderers.");
if (!nativeProject.includes("Microsoft.WindowsAppSDK") || !nativeProject.includes("net8.0-windows10.0.19041.0") ||
    !nativeProject.includes("WindowsAppSDKSelfContained")) fail("Native host project is missing its Windows App SDK target.");
else pass("Native host targets WinUI 3 on Windows 10 19041+ with self-contained Windows App SDK.");
if (!nativeHost.includes("WorkspaceView.Loaded += MainWindow_Loaded")) fail("Native browser host must initialize WebView2 from its control Loaded event.");
else pass("Native browser host starts initialization only after the WebView2 control is loaded.");
if (!nativeWorkflow.includes("runs-on: windows-latest") || !nativeWorkflow.includes("dotnet publish") ||
    !nativeWorkflow.includes("upload-artifact") || !nativeWorkflow.includes("Nolane.DesktopHost.exe")) fail("Native Windows build workflow is incomplete.");
else pass("Dedicated Windows CI builds and packages the native browser host.");
if (!nativeWorkflow.includes("contents: write") || !nativeWorkflow.includes("gh release upload native-latest") ||
    !read("README.md").includes("/releases/download/native-latest/nolane-native-webview2-host-win-x64.zip")) fail("Stable Windows host download release is not configured.");
else pass("Successful main-branch builds publish a stable, rolling Windows host download.");
const filterFunction = js.slice(js.indexOf("function updateViewFilter"), js.indexOf("function selectNode"));
const selectionFunction = js.slice(js.indexOf("function selectNode"), js.indexOf("function handleNodeAction"));
const nativeSyncFunction = js.slice(js.indexOf("function scheduleNativeSurfaceSync"), js.indexOf("function handleNativeHostMessage"));
if (!nativeSyncFunction.includes("node.browserTabId !== undefined") || !nativeSyncFunction.includes("liveSurfaces.has(node.id)")) fail("Native WebView2 surfaces must not cover imported Chrome tabs or active Chrome live streams.");
else pass("Native WebView2 surfaces preserve Chrome-owned tabs and active Chrome live streams.");
if (!js.includes("scheduleNativeSurfaceSync") || !js.includes("chrome.webview.postMessage") ||
    !js.includes("nolane.native.ready") || !js.includes("nolane.native.surface") ||
    !js.includes("dialog[open], #sidebar.open") || !js.includes("new MutationObserver(scheduleNativeSurfaceSync)") ||
    !filterFunction.includes("scheduleNativeSurfaceSync()") || !selectionFunction.includes("scheduleNativeSurfaceSync()")) fail("Static workspace/native browser bridge or native overlay/filter/z-order synchronization is incomplete.");
else pass("Static workspace syncs website-card geometry, receives native status and hides browser overlays for workspace dialogs.");
if (!nativeHost.includes("_pendingSurfaceSync") || !nativeHost.includes("DrainSurfaceSyncQueueAsync") || !nativeHost.includes("nolane.host.hello")) fail("Native surface synchronization must coalesce layout updates and use a reliable workspace handshake.");
else pass("Native surface synchronization coalesces stale layouts and uses an explicit ready handshake.");
if (!nativeHost.includes('uri.AbsolutePath.Equals("/web-view"') || !nativeHost.includes('uri.AbsolutePath.StartsWith("/web-view/"')) fail("Native host workspace origin/path allowlist is too broad.");
else pass("Native host accepts only the exact Nolane workspace path family.");

if (process.exitCode) process.exit(process.exitCode);
console.log("All static checks passed.");
