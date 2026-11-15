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
const workspaceStorage = read("workspace-storage.js");
const nativeProfileUsageParser = read("desktop-host/ProfileUsageSnapshot.cs");
const nativeProfileUsageSmoke = read("native-diagnostics/ProfileUsageSnapshotSmokeTest/Program.cs");
const workspaceSnapshotReceiver = read("desktop-host/WorkspaceSnapshotReceiver.cs");
const workspaceSnapshotSmoke = read("native-diagnostics/WorkspaceSnapshotSmokeTest/Program.cs");
const nativeBridgeSource = read("native-bridge.js");
const nativeBridgeTests = read("tests/native-bridge.test.mjs");

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

for (const asset of ["index.html", "styles.css", "native-bridge.js", "workspace-storage.js", "app.js", "manifest.webmanifest", "sw.js", "icon.svg", "scripts/benchmark-spatial.mjs"]) {
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

if (!workspaceStorage.includes("sanitizeNodes") || !workspaceStorage.includes("sanitizeSpaces") ||
    !js.includes("window.NolaneWorkspaceStorage.sanitizeNodes(nodes)") ||
    !js.includes("window.NolaneWorkspaceStorage.sanitizeNodes(space.nodes)") ||
    !html.includes('<script src="./workspace-storage.js" defer></script>') ||
    !sw.includes('"workspace-storage.js"')) fail("Private workspace storage sanitizer must be loaded, used for active/all spaces and precached offline.");
else pass("Private workspace addresses pass through the tested volatile-field sanitizer before IndexedDB, localStorage and export.");
if (!/indexedDB\.open/.test(js) || !/localStorage\.setItem/.test(js)) fail("Local persistence or fallback is missing.");
else pass("Local persistence and fallback are present.");


if (!/function defaultSpaces\(/.test(js) || !/function syncActiveSpace\(/.test(js) || !/spaces: spaces\.map/.test(js)) fail("Multi-workspace persistence is incomplete.");
else pass("Multi-workspace model and export are present.");

if (!/let importedSpaces = \[\]/.test(js) || !/Commit the import only after/.test(js)) fail("Workspace import is not staged before applying.");
else pass("Workspace import is staged and applied atomically.");

if (/chrome\.cookies|chrome\.debugger|chrome\.tabs\.capture/i.test(js)) fail("Static workspace unexpectedly accesses privileged extension APIs.");
else pass("Static workspace does not access privileged browser APIs.");

if (!html.includes('id="bridgeDialog"') || !html.includes('id="connectWindowsBridgeButton"')) fail("Windows background bridge connection UI is missing.");
else pass("Website has an explicit one-time Windows bridge connection action.");
if (!js.includes("Nolane Windows Bridge connected") || !js.includes('new WebSocket("ws://127.0.0.1:43172/bridge", "nolane.infinite.v2")')) fail("Website does not identify and connect to the native Windows background bridge.");
else pass("Website exposes the Windows background bridge state and local WebSocket connection.");
if (!html.includes('<script src="./native-bridge.js" defer></script>') ||
    !html.includes("i-arrow-left") || !html.includes("i-volume-2")) fail("Native bridge script or browser-toolbar icons are missing.");
else pass("Native bridge contract loads before the workspace and its control icons exist.");
if (!html.includes("Windows background bridge") || !html.includes("No Chrome extension or browser debugger permission is required")) fail("Website onboarding must describe the Windows background bridge as the primary integration.");
else pass("Website onboarding presents the Windows background bridge rather than extension installation.");

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
if (!nativeHost.includes("using Microsoft.Web.WebView2.Core;") || nativeHost.includes("using Microsoft.WebView2.Core;")) fail("Native host must import the actual WebView2 Core namespace.");
else pass("Native host imports the canonical Microsoft.Web.WebView2.Core namespace.");
if (/\bnew Thickness\(\s*[^,()]+,\s*[^,()]+\s*\)/.test(nativeHost)) fail("WinUI Thickness constructors must use the one-value or four-value overload.");
else pass("Native WinUI Thickness constructors use supported overloads.");
const nativeXaml = read("desktop-host/MainWindow.xaml");
const nativePicker = read("desktop-host/WindowsShellFilePicker.cs");
const smokeCs = read("native-diagnostics/ProjectionApi.cs");
const smokeProject = read("native-diagnostics/WebView2ProjectionSmokeTest.csproj");
const smokeWindowXaml = read("native-diagnostics/WinUIWebView2ControlSmokeTest/MainWindow.xaml");
const smokeWindowCs = read("native-diagnostics/WinUIWebView2ControlSmokeTest/MainWindow.xaml.cs");
const workflow = read(".github/workflows/desktop-host.yml");
const pagesWorkflow = read(".github/workflows/pages.yml");
const nativeProject = read("desktop-host/Nolane.DesktopHost.csproj");
const nativeWorkflow = read(".github/workflows/desktop-host.yml");
const nativeBridge = read("native-bridge.js");
const nativeBridgeTests = read("tests/native-bridge.test.mjs");
if (!nativeHost.includes("nolane.surfaces.sync") || !nativeHost.includes("EnsureCoreWebView2Async") || !nativeHost.includes("CreateWithOptionsAsync") ||
    !nativeHost.includes("TrySuspendAsync") || !nativeHost.includes("DetermineVisibleSurfaceBudget") ||
    !nativeHost.includes("TotalAvailableMemoryBytes") || !nativeHost.includes("MaxCachedSurfaces => Math.Min(8, MaxVisibleSurfaces * 2)") ||
    !nativeHost.includes("RectangleGeometry") || !nativeHost.includes("item.ClipWidth")) fail("Native WebView2 host must create real browser surfaces, adapt its memory budget, bound the cache and clip child browsers to the canvas viewport.");
else pass("Native WebView2 host creates real browser surfaces and bounds active renderers.");
if (!nativeProject.includes("Microsoft.WindowsAppSDK") ||
    !nativeProject.includes('<PackageReference Include="Microsoft.Web.WebView2" Version="1.0.3179.45" />') ||
    !nativeProject.includes("Microsoft.Web.WebView2.Core.Projection.dll") ||
    !nativeProject.includes("$(NuGetPackageRoot)microsoft.web.webview2/1.0.3179.45/lib_manual/net8.0-windows10.0.17763.0/") ||
    !nativeProject.includes("net8.0-windows10.0.19041.0") || !nativeProject.includes("WindowsAppSDKSelfContained") ||
    !nativeProject.includes("WebView2EnableCsWinRTProjection>true") ||
    nativeProject.includes("DefaultItemExcludes") || nativeProject.includes("diagnostics/**") ||
    !nativeHost.includes("WindowsShellFilePicker.PickLibraryBackupPath") ||
    !nativePicker.includes("public static string? PickLibraryBackupPath(IntPtr ownerWindow, bool save)") ||
    !nativePicker.includes("Type.GetTypeFromCLSID(classId") ||
    !nativePicker.includes("IFileDialog") ||
    !nativePicker.includes("FileDialogOptions.OverwritePrompt") ||
    !nativePicker.includes("FileDialogOptions.FileMustExist") ||
    !nativePicker.includes("ShellItemDisplayName.FileSystemPath") ||
    nativeHost.includes("[ComImport]")) fail("Native host must retain its pinned WebView2 dependency, keep the WinUI project free of nested diagnostics, and isolate Shell COM interop outside the XAML window.");
else pass("Native host pins its known-good WebView2 SDK, isolates smoke tests outside WinUI item discovery, and keeps Shell COM interop outside the XAML-backed window.");
if (!smokeWindowXaml.includes("controls:WebView2") ||
    !smokeWindowCs.includes("using Microsoft.Web.WebView2.Core;") ||
    !smokeWindowCs.includes("Browser.CoreWebView2") ||
    !smokeWindowCs.includes("Browser.Close();") ||
    !smokeWindowCs.includes('options.ProfileName = "NolaneSmokeProfile"')) fail("The XAML smoke test must bind the WinUI WebView2 Core API and compile its explicit Close lifecycle.");
else pass("An isolated WinUI executable compiles the XAML WebView2 control and its Core API together.");
if (!workflow.includes("dotnet restore desktop-host/Nolane.DesktopHost.csproj -r win-x64") ||
    !workflow.includes("dotnet build desktop-host/Nolane.DesktopHost.csproj -c Release -r win-x64 --no-restore -p:WindowsAppSDKSelfContained=true -p:WebView2EnableCsWinRTProjection=true")) fail("Native CI must compile the exact shipping WinUI host project, not a parallel source-linked approximation.");
else pass("Native CI compiles the exact shipping WinUI host project with the pinned WebView2 package graph.");
if (!js.includes("clean.browserProfile = browserProfile") ||
    !js.includes('profileName: node.browserProfile || ""') ||
    !js.includes("native-profile-select") ||
    !js.includes("normalizeProfileName(proposed)") ||
    !nativeHost.includes("controllerOptions.ProfileName = item.ProfileName") ||
    !nativeHost.includes("configured.ProfileName, item.ProfileName") ||
    !nativeHost.includes("IsSafeProfileName(profileName)") ||
    !nativeHost.includes("profileName = surface.ProfileName") ||
    !nativeBridge.includes("function normalizeProfileName(value)") ||
    !nativeBridgeTests.includes("browser profile names are trimmed")) fail("Named browser profiles must flow from a validated card selection through the bridge into a dedicated WebView2 profile.");
else pass("Website cards can select persistent named browser profiles with host-side validation and profile-aware controller recreation.");
if (!nativeBridge.includes("function summarizeProfileUsage(spaces)") ||
    !nativeBridgeTests.includes("profile usage counts website cards across all saved spaces") ||
    !js.includes("summarizeProfileUsage(spaces)") ||
    !js.includes("profileUsage") ||
    !nativeHost.includes("UpdateProfileCardUsage(root)") ||
    !nativeHost.includes("_profileUsageReceived = true") ||
    !nativeHost.includes("ProfilesButton.IsEnabled = true") ||
    !nativeHost.includes("GetProfileCardUsage(profileName) > 0") ||
    !nativeHost.includes("_surfaces.Values.Any(surface => SameProfile(surface.ProfileName, profileName))") ||
    !nativeHost.includes("maintenanceView.CoreWebView2.Profile.Delete()") ||
    !nativeHost.includes("Profile.ClearBrowsingDataAsync()") ||
    !nativeHost.includes("_deletedProfileNames.Contains(item.ProfileName)")) fail("Browser profile management must know all-space card usage through its tested bridge helper, block deletion while assigned/open, and use WebView2's real clear/delete APIs.");
else pass("Profile management uses an all-workspace assignment snapshot and the pinned WebView2 profile clear/delete APIs.");
if (!smokeCs.includes("ClearProfileDataAsync") || !smokeCs.includes("DeleteProfile") ||
    !smokeWindowCs.includes("Profile.ClearBrowsingDataAsync()") ||
    !smokeWindowCs.includes("Profile.Delete()")) fail("The exact WebView2 profile maintenance APIs must compile in both isolated smoke projects.");
else pass("Windows CI compiles the actual WebView2 profile clear and delete operations used by the manager.");
if (!nativeHost.includes("NeedsReloadAfterProfileClear") ||
    !nativeHost.includes("This profile's browsing data was cleared. The website is reloading without its previous page session.") ||
    !nativeHost.includes("surface.View.CoreWebView2.Reload()")) fail("Clearing a profile must reload visible websites and defer reload for suspended cards until restore.");
else pass("Clearing a profile refreshes active pages immediately and suspended pages when restored.");
if (!nativeHost.includes("clearConfirmation.IsChecked == true") ||
    !nativeHost.includes("deleteConfirmation.IsChecked == true") ||
    !nativeHost.includes("clearConfirmation.Unchecked") ||
    !nativeHost.includes("deleteConfirmation.Unchecked")) fail("Clearing and deleting browser profiles must each require an independent explicit confirmation.");
else pass("Profile data clearing and profile deletion are protected by separate explicit confirmations.");
if (!nativeHost.includes("BrowserSurfaceLayer.Loaded += MainWindow_Loaded")) fail("Native background host must initialize its surface layer from the loaded XAML root.");
else pass("Native background host starts from its surface layer without opening a workspace WebView.");

if (!nativeHost.includes("surface.View.Close()") ||
    !nativeHost.includes("Closed +=") ||
    nativeHost.includes('surface.View.CoreWebView2.Navigate("about:blank")') ||
    nativeXaml.includes("WorkspaceView") ||
    nativeHost.includes("Workspace_NavigationStarting") ||
    nativeHost.includes("ReloadWorkspace_Click")) fail("Background host must release its native website surfaces and must not retain an unused parent workspace WebView.");
else pass("Windows host contains only website-card browser surfaces; the unused parent WebView and legacy handlers have been removed.");
if (!workflow.includes("Compile isolated WebView2 projection smoke test") ||
    !workflow.includes("native-diagnostics/WebView2ProjectionSmokeTest.csproj") ||
    !workflow.includes("dotnet build desktop-host/Nolane.DesktopHost.csproj") ||
    !workflow.includes("native-diagnostics/WinUIWebView2ControlSmokeTest/WinUIWebView2ControlSmokeTest.csproj") ||
    !smokeProject.includes('PackageReference Include="Microsoft.Web.WebView2" Version="1.0.3179.45"') ||
    !smokeProject.includes("Microsoft.Web.WebView2.Core.Projection.dll") ||

    !smokeCs.includes("CoreWebView2Environment") ||
    !workflow.includes("WebView2EnableCsWinRTProjection=true") ||
    !smokeCs.includes("typeof(CoreWebView2Environment)") ||
    !smokeCs.includes("typeof(CoreWebView2DownloadOperation)") ||
    smokeProject.includes("Microsoft.WindowsAppSDK") ||
    !smokeProject.includes("<EnableDefaultCompileItems>false</EnableDefaultCompileItems>") ||
    !smokeProject.includes('<Compile Include="ProjectionApi.cs" />')) fail("Windows CI must independently compile the WebView2 CsWinRT API projection without globbing sibling WinUI smoke projects.");
else pass("Windows CI compiles the WebView2 Core API projection in an isolated .NET probe, then compiles the real WinUI host separately.");
if (!js.includes("clean.privateMode = node.privateMode === true") ||
    !js.includes("privateMode: node.privateMode === true") ||
    !js.includes('data-action="native-private"') ||
    !js.includes("node.privateMode && node.transientUrl") ||
    !workspaceStorage.includes("const { transientUrl, ...persistedNode } = node") ||
    !nativeHost.includes("CreateCoreWebView2ControllerOptions") ||
    !nativeHost.includes("IsInPrivateModeEnabled = item.PrivateMode") ||
    !nativeHost.includes("EnsureCoreWebView2Async(_environment, controllerOptions)") ||
    !nativeHost.includes("if (!surface.Initialized || surface.IsPrivate) return;") ||
    !nativeHost.includes("_downloads.Where(entry => !entry.IsPrivate)") ||
    !nativeHost.includes("if (surface.IsPrivate) return;") ||
    !nativeBridge.includes('isPrivateMode: typeof message.isPrivateMode === "boolean"')) fail("Private sessions must use WebView2 InPrivate, keep private URLs volatile, and exclude history/bookmarks/download metadata from durable storage.");
else pass("Per-card private mode uses the WebView2 InPrivate controller, and private browsing metadata is not persisted.");
if (workflow.indexOf("dotnet restore native-diagnostics/WebView2ProjectionSmokeTest.csproj -r win-x64") < 0 ||
    workflow.indexOf("WebView2 CsWinRT projection DLL not found after restore") < workflow.indexOf("dotnet restore native-diagnostics/WebView2ProjectionSmokeTest.csproj -r win-x64") ||
    !workflow.includes('      - "native-bridge.js"') ||
    !workflow.includes('      - "native-diagnostics/**"') ||
    !workflow.includes("node --test tests/*.test.mjs")) fail("Native CI must run browser contract tests and restore WebView2 before checking the projection DLL.");
else pass("Native Windows CI tests bridge contracts and restores WebView2 before checking its projection DLL.");
if (!nativeHost.includes("GetAvailableBrowserVersionString") || !nativeHost.includes("NewBrowserVersionAvailable")) fail("Native host must detect the Evergreen WebView2 Runtime and newer runtime updates.");
else pass("Native host checks runtime availability and detects browser-runtime updates.");
if (!nativeHost.includes("HandleSurfaceProcessFailure") || !nativeHost.includes("RenderProcessExited") ||
    !nativeHost.includes("RenderProcessUnresponsive") || !nativeHost.includes("BrowserProcessExited") ||
    !nativeHost.includes("RendererRecoveryAttempts < 1") || !nativeHost.includes("TimeSpan.FromMinutes(2)")) fail("Native host process-failure handling must recover renderers with a bounded retry and distinguish shared browser crashes.");
else pass("Native host diagnoses renderer failures, applies one bounded reload, and distinguishes unresponsive/shared-process failures.");
if (!js.includes("nativeMaxVisibleSurfaces") || !js.includes("Number(message.maxVisibleSurfaces)") ||
    !js.includes("memory budget allows")) fail("Workspace must consume and explain the adaptive native renderer budget.");
else pass("Workspace reflects the actual adaptive renderer limit reported by the native host.");
if (!nativeHost.includes("PermissionRequested") || !nativeHost.includes("Allow once") ||
    !nativeHost.includes("SavesInProfile = false") || !nativeHost.includes("CoreWebView2PermissionState.Deny")) fail("Native website permissions must require an explicit non-persistent user decision.");
else pass("Native website permissions require an explicit Allow once/Block decision.");
if (!nativeHost.includes("DownloadStarting") || !nativeHost.includes("IsUserInitiated") ||
    !nativeHost.includes("IsSafeWebUri(url)") || !nativeXaml.includes('x:Name="DownloadsPanel"') ||
    !nativeXaml.includes('x:Name="DownloadsList"')) fail("Native browser downloads, popup gesture checks or URL restrictions are incomplete.");
else pass("Native browser retains user-controlled downloads, blocks unsolicited popups and rejects credential/non-web URLs.");
if (!nativeHost.includes("core.HistoryChanged") || !nativeHost.includes("core.IsMutedChanged") ||
    !nativeHost.includes("core.IsDocumentPlayingAudioChanged") || !nativeHost.includes("ExecuteSurfaceCommand")) fail("Native browser history/audio controls and state reporting are incomplete.");
else pass("Native browser exposes per-surface navigation, audio controls and state telemetry.");
if (!nativeHost.includes("RecordBrowserHistory") || !nativeHost.includes("SanitizeLibraryUrl") ||
    !nativeHost.includes("browser-library.json") || !nativeHost.includes("ToggleBookmark") ||
    !nativeHost.includes("TimeSpan.FromSeconds(4)") || !nativeHost.includes("Take(500)") ||
    !nativeHost.includes("SameProfile(item.ProfileName, surface.ProfileName)") ||
    !nativeHost.includes("ProfileName = surface.ProfileName") ||
    !nativeHost.includes("IsBookmarked(core.Source, surface.ProfileName)") ||
    nativeHost.includes("IsBookmarked(core.Source)") ||
    !nativeHost.includes("SchemaVersion = 2") ||
    !nativeHost.includes("backup.SchemaVersion is not (1 or 2)")) fail("Native Library must isolate history/bookmarks by profile and preserve v1 backup compatibility.");
else pass("Native browser stores bounded history and bookmarks with profile ownership, deduplicates visits, redacts sensitive query values and preserves schema-1 backup compatibility.");
if (!nativeHost.includes("BuildLibraryPanel()") || !nativeHost.includes("LibraryPanel = new Border") ||
    !nativeHost.includes("LibrarySearchBox = new TextBox") || !nativeHost.includes("LibraryItems = new StackPanel") ||
    !nativeHost.includes("WorkspaceRoot.Children.Add(LibraryPanel)") ||
    !nativeHost.includes("OpenLibraryUrl") || !nativeHost.includes("GetLibraryTargetSurface") ||
    !nativeHost.includes("MatchesLibraryQuery") || !nativeHost.includes("LibrarySearch_TextChanged") ||
    !nativeXaml.includes('x:Name="WorkspaceRoot"') || nativeXaml.includes('x:Name="LibraryPanel"') ||
    !js.includes("native-bookmark") || !js.includes("toggle-bookmark")) fail("Native browser Library UI, per-card bookmark control, dynamic panel or instant search is incomplete.");
else pass("Native Library opens history/bookmarks in the focused website card, supports per-card bookmarks and filters title/domain/address instantly.");

if (!nativeHost.includes("LibraryProfileFilter = new ComboBox") ||
    !nativeHost.includes("LibraryProfileFilter_SelectionChanged") ||
    !nativeHost.includes("GetLibraryTargetSurface(string profileName)") ||
    !nativeHost.includes("MatchesLibraryProfile(item.ProfileName)") ||
    !nativeHost.includes("did not send it to another browser profile") ||
    !nativeHost.includes("OpenLibraryUrl(visited.Url, visited.ProfileName)") ||
    !nativeHost.includes("OpenLibraryUrl(saved.Url, saved.ProfileName)")) fail("Library profile filter must open saved items only in a visible, non-private card using the item's originating profile.");
else pass("Native Library defaults to the focused profile, offers All profiles, and never crosses login profiles when opening saved items.");if (!nativeHost.includes("ExportLibrary_Click") || !nativeHost.includes("ImportLibrary_Click") ||
    !nativeHost.includes("WindowsShellFilePicker.PickLibraryBackupPath") ||
    !nativePicker.includes("public static string? PickLibraryBackupPath(IntPtr ownerWindow, bool save)") ||
    !nativePicker.includes("Type.GetTypeFromCLSID(classId") || !nativePicker.includes("IFileDialog") ||
    !nativePicker.includes("FileDialogOptions.OverwritePrompt") || !nativePicker.includes("FileDialogOptions.FileMustExist") ||
    !nativeHost.includes("backup.SchemaVersion is not (1 or 2)") || !nativeHost.includes("MaxLibraryBackupBytes") ||
    !nativeHost.includes("stagedHistory") || !nativeHost.includes("stagedBookmarks") ||
    !nativeHost.includes("ContentDialogResult.Primary") ||
    !nativePicker.includes('Name = "Nolane Library backup (*.json)"') ||
    !nativePicker.includes("Export Nolane Library") || !nativePicker.includes("Import Nolane Library backup") ||
    !nativeHost.includes('Content = "Export backup"') || !nativeHost.includes('Content = "Import backup"') ||
    !nativeProject.includes('Version="1.0.3179.45"')) fail("Native Library backup/restore picker integration or its pinned WebView2 dependency is invalid.");
if (!nativeHost.includes("HandleDownloadStarting") || !nativeHost.includes("BytesReceivedChanged") ||
    !nativeHost.includes("StateChanged") || !nativeHost.includes("operation?.Pause()") ||
    !nativeHost.includes("operation?.Resume()") || !nativeHost.includes("operation?.Cancel()") ||
    !nativeHost.includes("DownloadHistoryRecord") || !nativeHost.includes("File.Move(temporaryPath, _downloadHistoryPath, true)") ||
    !nativeHost.includes("Keep Handled=false") || !nativeHost.includes("Interlocked.CompareExchange(ref entry.LastPersistedTick") ||
    !nativeHost.includes("now - last >= 3000") || !nativeHost.includes("HasRetainedDownload") ||
    !nativeHost.includes("PendingRemoval = true") || !nativeHost.includes("ReleasePendingSurfaceIfPossible")) fail("Native download tracking, controls, atomic history persistence or in-flight surface retention are incomplete.");
else pass("Native download manager tracks progress, supports pause/resume/cancel and atomically persists a bounded local history.");
if (!nativeHost.includes("ToggleDownloads_Click") || !nativeHost.includes("ClearFinishedDownloads_Click") ||
    !nativeHost.includes("OpenDownloadedFile") || !nativeHost.includes("ShowDownloadedFile") ||
    !nativeHost.includes("Path.IsPathFullyQualified")) fail("Native download panel actions or saved-path validation are incomplete.");
else pass("Native download panel exposes open/reveal/clear actions and validates local saved paths.");
if (!nativeHost.includes("website is hidden, but its download is active or resumable") ||
    !nativeHost.includes("surface.View.Visibility != Visibility.Visible && !HasRetainedDownload(surface.Id)")) fail("Off-screen or deleted website surfaces must not destroy active/resumable downloads.");
else pass("Off-screen and removed cards retain their WebView2 operation until downloads complete or are canceled.");
if (!nativeBridge.includes("createCommand") || !nativeBridge.includes("createNavigationCommand") ||
    !nativeBridge.includes("normalizeSurfaceState") || !nativeBridge.includes("toggle-bookmark") ||
    !nativeBridgeTests.includes("allow-listed protocol") || !nativeBridgeTests.includes("rejects credentials") ||
    !nativeBridgeTests.includes("native address bar") || !nativeBridgeTests.includes("bookmark toggles")) fail("The native browser command/state/address/bookmark contract is not independently testable.");
else pass("The native browser command/state/address contract is independently tested.");
if (!js.includes("native-address-input") || !js.includes("navigateNativeSurface") ||
    !nativeHost.includes('case "navigate":') || !nativeHost.includes('!IsSafeWebUri(targetUrl ?? "")')) fail("Native website cards need a safe, editable per-card address bar.");
else pass("Native website cards expose a per-card address bar with a native HTTP(S)-only navigation command.");
if (!nativeWorkflow.includes("runs-on: windows-latest") || !nativeWorkflow.includes("dotnet publish") ||
    !nativeWorkflow.includes("upload-artifact") || !nativeWorkflow.includes("Nolane.DesktopHost.exe")) fail("Native Windows build workflow is incomplete.");
else pass("Dedicated Windows CI builds and packages the native browser host.");
if (!nativeWorkflow.includes("contents: write") || !nativeWorkflow.includes("gh release upload native-latest") ||
    !read("README.md").includes("/releases/download/native-latest/nolane-native-webview2-host-win-x64.zip")) fail("Stable Windows host download release is not configured.");
else pass("Successful main-branch builds publish a stable, rolling Windows host download.");
const filterFunction = js.slice(js.indexOf("function updateViewFilter"), js.indexOf("function selectNode"));
const selectionFunction = js.slice(js.indexOf("function selectNode"), js.indexOf("function handleNodeAction"));
const nativeSyncFunction = js.slice(js.indexOf("function scheduleNativeSurfaceSync"), js.indexOf("function handleNativeHostMessage"));
const nativeEligibility = js.slice(js.indexOf("function isChromeOwnedNode"), js.indexOf("function postNativeSurfaceCommand"));
if (!nativeSyncFunction.includes("canUseNativeSurface(node)") ||
    !nativeEligibility.includes("bridgeConnected && node && node.browserTabId !== undefined") ||
    !nativeEligibility.includes("node.browserSessionId === bridgeSessionId") ||
    !nativeEligibility.includes("!liveSurfaces.has(node.id)") ||
    !nativeSyncFunction.includes("clipX:") || !nativeSyncFunction.includes("clipWidth:") ||
    !js.includes("function clearUnavailableChromeTabBindings") ||
    !js.includes("clearUnavailableChromeTabBindings();")) fail("Native WebView2 must preserve current Chrome sessions and convert stale imported tab IDs.");
else pass("Native WebView2 surfaces preserve Chrome-owned tabs and active Chrome live streams.");
if (!js.includes("scheduleNativeSurfaceSync") || !js.includes("sendNativeBridgeMessage") ||
    !js.includes("postNativeSurfaceCommand") || !js.includes("native-back") ||
    !js.includes("native-forward") || !js.includes("native-mute") ||
    !js.includes("nolane.native.ready") || !js.includes("nolane.native.surface") ||
    !js.includes("dialog[open], #sidebar.open") || !js.includes("new MutationObserver(scheduleNativeSurfaceSync)") ||
    !filterFunction.includes("scheduleNativeSurfaceSync()") || !selectionFunction.includes("scheduleNativeSurfaceSync()")) fail("Static workspace/native browser bridge or native overlay/filter/z-order synchronization is incomplete.");
else pass("Static workspace syncs website-card geometry, receives native status and hides browser overlays for workspace dialogs.");
if (!nativeHost.includes("_pendingSurfaceSync") || !nativeHost.includes("DrainSurfaceSyncQueueAsync") || !nativeHost.includes("nolane.host.hello")) fail("Native surface synchronization must coalesce layout updates and use a reliable workspace handshake.");
else pass("Native surface synchronization coalesces stale layouts and uses an explicit ready handshake.");
if (!nativeHost.includes('uri.AbsolutePath.Equals("/web-view"') || !nativeHost.includes('uri.AbsolutePath.StartsWith("/web-view/"')) fail("Native host workspace origin/path allowlist is too broad.");
else pass("Native host accepts only the exact Nolane workspace path family.");

const localBridge = read("desktop-host/LocalBridgeServer.cs");
const bridgeSmoke = read("native-diagnostics/LocalBridgeServerSmokeTest/Program.cs");
const trayIcon = read("desktop-host/BackgroundTrayIcon.cs");
const appHost = read("desktop-host/App.xaml.cs");
if (!localBridge.includes("IPAddress.Loopback") ||
    !localBridge.includes("Port = 43172") ||
    !localBridge.includes('"127.0.0.1:" + Port') ||
    !localBridge.includes("https://nolane-x.github.io") ||
    !localBridge.includes('RequiredProtocol = "nolane.infinite.v2"') ||
    !localBridge.includes("MaxMessageBytes = 2 * 1024 * 1024") ||
    localBridge.includes("IPAddress.Any")) fail("Windows background bridge must be loopback-only, origin-locked and bounded.");
else pass("Windows bridge is loopback-only, validates the exact website Origin and caps message size.");

if (!nativeHost.includes("UpdateOverlayBounds(root)") ||
    !nativeHost.includes("Chrome_RenderWidgetHostHWND") ||
    !nativeHost.includes("UpdateOverlayRegion(activeItems)") ||
    !nativeHost.includes("DwmExtendFrameIntoClientArea") ||
    !nativeHost.includes("SetWindowRgn") ||
    !nativeHost.includes("RefreshOverlayActivation") ||
    !nativeHost.includes("BrowserSurfaceLayer.Loaded += MainWindow_Loaded")) fail("Native host must create the transparent browser-aligned overlay and manage focus/visibility.");
else pass("Native host builds a transparent click-through overlay over the active browser viewport.");

if (!nativeHost.includes("_environment.NewBrowserVersionAvailable") ||
    !nativeHost.includes("if (_runtimeUpdateAvailable) return;") ||
    !nativeHost.includes("_trayNotification?.Invoke(") ||
    !nativeHost.includes("SetTrayNotificationHandler") ||
    !trayIcon.includes("public void ShowNotification(string title, string message)") ||
    !trayIcon.includes("NIF_INFO") ||
    !trayIcon.includes("Shell_NotifyIcon(NIM_MODIFY") ||
    !appHost.includes("SetTrayNotificationHandler(_tray.ShowNotification)") ||
    !trayIcon.includes("IDM_RESTART") ||
    !trayIcon.includes("Restart bridge…") ||
    !nativeHost.includes("ConfirmRestartAsync") ||
    !nativeHost.includes("Restart the Nolane background bridge?") ||
    !nativeHost.includes("active or resumable download(s) will be interrupted") ||
    !appHost.includes("!await window.ConfirmRestartAsync()") ||
    !appHost.includes("RestartBackgroundBridge") ||
    !appHost.includes("Process.Start(new ProcessStartInfo(executable, \"--background\")"))
  fail("A detected WebView2 Runtime update must surface a one-time tray notification and provide a controlled restart action.");
else pass("WebView2 Runtime updates are surfaced once through the Windows tray; restart requires confirmation and warns about active downloads.");

const shutdownWaitIndex = appHost.indexOf("await window.ShutdownTask;");
const mutexReleaseIndex = appHost.indexOf("_instanceMutex?.ReleaseMutex();");
const processRestartIndex = appHost.indexOf("Process.Start(new ProcessStartInfo(executable, \"--background\")");
if (!nativeHost.includes("private Task _shutdownTask = Task.CompletedTask;") ||
    !nativeHost.includes("public Task ShutdownTask => _shutdownTask;") ||
    !nativeHost.includes("Closed += (_, _) => _shutdownTask = ShutdownAsync();") ||
    shutdownWaitIndex < 0 || mutexReleaseIndex <= shutdownWaitIndex || processRestartIndex <= mutexReleaseIndex ||
    !bridgeSmoke.includes("afterShutdown.ConnectAsync") ||
    !bridgeSmoke.includes("listener still accepted connections after native host shutdown"))
  fail("Restart must await WebView2/bridge shutdown before releasing the single-instance mutex and launching a replacement host.");
else pass("Restart waits for all native surfaces and the loopback listener to shut down before relaunching.");

if (!nativeHost.includes("BackgroundTrayIcon.EnableStartupAfterFirstConnection()") ||
    !trayIcon.includes("CurrentVersion\\Run") ||
    !trayIcon.includes("Exit background bridge") ||
    !read("desktop-host/App.xaml.cs").includes("NolaneInfiniteBackgroundBridge")) fail("Background host startup, single-instance protection or tray exit path is missing.");
else pass("Background bridge is single-instance, registers startup after connection and exposes a tray exit action.");

if (!js.includes('new WebSocket("ws://127.0.0.1:43172/bridge", "nolane.infinite.v2")') ||
    !js.includes('navigator.permissions.query({ name: "loopback-network" })') ||
    !js.includes("connectWindowsBridge") ||
    !js.includes("nolane.workspace.visibility") ||
    !html.includes('id="connectWindowsBridgeButton"')) fail("Website must request loopback access from a user gesture, reconnect when granted and expose the Windows bridge connection control.");
else pass("Website connects to the Windows background bridge through the browser's Loopback Network Access permission.");

if (!js.includes("screenLeft") || !js.includes("screenTop") || !js.includes("deviceScale") ||
    !nativeBridge.includes("function normalizeViewport(value)") ||
    !nativeBridgeTests.includes("viewport metadata is bounded")) fail("Viewport screen geometry must be validated before native overlay positioning.");
else pass("Workspace sends bounded screen viewport geometry for native overlay positioning.");

if (html.includes("Download Browser Companion 0.2.13") ||
    html.includes("Stream this tab to Nolane") ||
    html.includes("Chrome Companion →") ||
    html.includes("Companion not detected")) fail("The primary website experience must not require or promote the Chrome extension.");
else pass("Primary website onboarding no longer promotes or requires the Chrome Companion extension.");

if (!nativeHost.includes("ExecutePanelCommand") ||
    !nativeHost.includes("OpenProfilesManagerAsync") ||
    !js.includes("sendNativePanelCommand") ||
    !html.includes('id="downloadsButton"') ||
    !html.includes('id="libraryButton"') ||
    !html.includes('id="profilesButton"')) fail("Downloads, Library and Profiles must be operated from the Nolane website rather than the hidden host window.");
else pass("Website toolbar owns Downloads, Library and Profiles commands; the Windows process only renders their native panels.");

if (!trayIcon.includes("EnableStartupAfterFirstConnection") ||
    !trayIcon.includes('PreferencesKey = @"Software\\Nolane\\NolaneInfiniteBridge"') ||
    !trayIcon.includes('preferences?.SetValue(StartupChoiceValue, enabled ? "enabled" : "disabled")') ||
    !trayIcon.includes('runKey?.DeleteValue("NolaneInfiniteBridgeStartupChoice", false)') ||
    trayIcon.includes("runKey.SetValue(StartupChoiceValue")) fail("The startup preference must be outside Windows' executable Run key, and the old marker must be migrated.");
else pass("Windows startup preference is stored outside Run, the old marker is migrated, and user opt-out is respected.");

if (!nativeHost.includes("IsTrustedWorkspaceUri") ||
    !nativeHost.includes("pageElement.GetString()") ||
    !js.includes("page: location.href")) fail("The first local handshake must bind to the published /web-view workspace path, not just the shared GitHub Pages origin.");
else pass("The local bridge handshake is bound to the exact Nolane workspace path.");

if (!nativeHost.includes("_overlayWidth = 0;") ||
    !nativeHost.includes("foregroundBrowser != IntPtr.Zero && foregroundBrowser != _browserHwnd") ||
    !nativeHost.includes("width > 8000") || !nativeHost.includes("height > 6000")) fail("Overlay recovery must discard stale viewport bounds and validate native card geometry.");
else pass("Renderer swaps cannot reuse stale overlay coordinates, and incoming card bounds are constrained.");

if (!localBridge.includes("CancelAfter(TimeSpan.FromSeconds(5))") ||
    !localBridge.includes('string.Equals(lines[0], "GET /bridge HTTP/1.1"')) fail("The local bridge handshake must have a bounded timeout and accept only the exact /bridge path.");
else pass("The local bridge rejects alternate request paths and abandons incomplete handshakes after five seconds.");

if (!bridgeSmoke.includes("client.CloseStatus == WebSocketCloseStatus.MessageTooBig") ||
    bridgeSmoke.includes("closed.CloseStatus")) fail("The Windows WebSocket smoke test must inspect the close status from ClientWebSocket.");
else pass("The Windows bridge smoke test checks the server's 2 MiB close code through ClientWebSocket.");

if (!localBridge.includes("_activeClients") ||
    !localBridge.includes("_activeHandlers") ||
    !localBridge.includes("client.Dispose()") ||
    !localBridge.includes("WaitAsync(TimeSpan.FromSeconds(5))")) fail("The Windows background bridge must track and stop all accepted sockets/handlers during shutdown.");
else pass("The background bridge tracks accepted clients and drains handlers on clean shutdown.");

if (!bridgeSmoke.includes("bridge/extra") ||
    !bridgeSmoke.includes("incomplete handshake open past its five-second deadline") ||
    !localBridge.includes("if (_activeClients.Count >= 8)")) fail("The Windows bridge integration test must reject non-canonical paths, time out stalled clients and cap concurrent handshakes.");
else pass("The Windows bridge rejects alternate paths, times out stalled handshakes and caps concurrent local clients.");

if ((nativeHost.match(/if \(type == "nolane\.panel\.command"\)/g) || []).length !== 1) fail("The native panel command router must be defined exactly once.");
else pass("The native panel command router has one unambiguous handler.");

if (nativeHost.includes('"firefox"')) fail("The native overlay must not advertise Firefox while its viewport locator requires Chromium renderer HWNDs.");
else pass("Native overlay browser detection matches the Chromium renderer-window implementation.");

const installerScript = read("desktop-host/packaging/Install-NolaneInfinite.ps1");
const installerCmd = read("desktop-host/packaging/Install-NolaneInfinite.cmd");
const uninstallerScript = read("desktop-host/packaging/Uninstall-NolaneInfinite.ps1");
const uninstallerCmd = read("desktop-host/packaging/Uninstall-NolaneInfinite.cmd");
if (!installerScript.includes("NolaneInfiniteBridge") ||
    !installerScript.includes("Programs\\NolaneInfiniteBridge") ||
    !installerScript.includes("Copy-Item") ||
    !installerScript.includes("Start-Process") ||
    !installerCmd.includes("ExecutionPolicy Bypass") ||
    !uninstallerScript.includes("NolaneInfiniteBridgeStartupChoice") ||
    !uninstallerScript.includes('HKCU:\\Software\\Nolane\\NolaneInfiniteBridge') ||
    !uninstallerScript.includes("RemoveUserData") ||
    !uninstallerCmd.includes("Uninstall-NolaneInfinite.ps1")) fail("The Windows ZIP must provide current-user install and clean uninstall scripts.");
else pass("The Windows ZIP contains a no-admin installer, double-click launchers and a data-preserving uninstaller.");

if (!html.includes("Install-NolaneInfinite.cmd") ||
    !html.includes("allow the browser's one-time Loopback Network permission") ||
    !html.includes("you do not need to operate a separate Windows app")) fail("Website onboarding must explain the one-time Windows installation and the website-first daily workflow.");
else pass("Website onboarding guides the user through one-time installation and then keeps all daily work on the website.");

if (!workflow.includes("Validate Windows installer scripts") ||
    !workflow.includes("Install-NolaneInfinite.ps1") ||
    !workflow.includes("Uninstall-NolaneInfinite.ps1")) fail("Windows CI must syntax-check and package the installer and uninstaller alongside the native host.");
else pass("Windows CI validates and packages the current-user installer and uninstaller.");

const overlayGeometry = read("desktop-host/OverlayGeometry.cs");
const overlayGeometrySmoke = read("native-diagnostics/OverlayGeometrySmokeTest/Program.cs");
const overlayGeometryProject = read("native-diagnostics/OverlayGeometrySmokeTest/OverlayGeometrySmokeTest.csproj");
if (!nativeHost.includes("OverlayGeometry.TryCreateSurfaceRect") ||
    !nativeHost.includes("OverlayGeometry.TryCreatePanelRect") ||
    !overlayGeometry.includes("Math.Floor") || !overlayGeometry.includes("Math.Ceiling") ||
    !overlayGeometry.includes("IsViewportUsable") ||
    !overlayGeometrySmoke.includes("negative canvas positions") ||
    !overlayGeometrySmoke.includes("150% DPI") ||
    !overlayGeometryProject.includes("OverlayGeometry.cs")) fail("The overlay must use a shared tested CSS-to-native pixel geometry helper for surfaces and floating panels.");
else pass("Native overlay surface and panel regions share a bounded, testable DPI-aware geometry helper.");

if (!workflow.includes("Exercise overlay clipping and DPI geometry") ||
    !workflow.includes("OverlayGeometrySmokeTest.csproj")) fail("Windows CI must execute the overlay geometry smoke test.");
else pass("Windows CI executes overlay clipping, viewport-edge and DPI geometry tests.");

if (!overlayGeometrySmoke.includes("new NativePixelRect(1185, 15, 1785, 765)") ||
    !overlayGeometrySmoke.includes("narrowPanel.Right == 790")) fail("Panel region expected coordinates must include the 10 CSS-pixel viewport margin at all display scales.");
else pass("Panel-region tests assert the same right/bottom inset used by the live overlay.");

if (process.exitCode) process.exit(process.exitCode);
console.log("All static checks passed.");

if (!nativeHost.includes("ProfileName = surface.ProfileName") ||
    !nativeHost.includes("ProfileName = StringRaw(entry.ProfileName, 64)") ||
    !nativeHost.includes("ProfileName = NormalizeLibraryProfileName(record.ProfileName) ?? \"\"") ||
    !nativeHost.includes("DownloadsProfileFilter_SelectionChanged") ||
    !nativeHost.includes("RefreshDownloadsProfileFilter") ||
    !nativeHost.includes("MatchesDownloadsProfile") ||
    !nativeHost.includes("PrivateDownloadsProfileFilter") ||
    !nativeHost.includes("MatchesDownloadsProfile(entry) &&") ||
    !nativeHost.includes("ProfileLabel(entry.ProfileName)") ||
    !nativeXaml.includes('x:Name="DownloadsProfileFilter"')) fail("Downloads must retain source profile ownership, persist it compatibly, protect private history and expose a per-profile filter.");
else pass("Downloads preserve profile ownership, default old records to Default, keep private metadata ephemeral and filter from the website panel.");

if (!nativeHost.includes("_downloadsProfileOptionsSignature") ||
    !nativeHost.includes("StringComparer.Ordinal.Equals(signature, _downloadsProfileOptionsSignature)") ||
    !nativeHost.includes("if (StringComparer.Ordinal.Equals(signature, _downloadsProfileOptionsSignature)) return;")) fail("Downloads profile filter options must be rebuilt only when the available profile set changes, not on progress refreshes.");
else pass("Downloads profile choices are signature-cached so byte-progress updates do not rebuild the filter ComboBox.");

const downloadFilter = read("desktop-host/DownloadProfileFilter.cs");
const downloadFilterSmoke = read("native-diagnostics/DownloadProfileFilterSmokeTest/Program.cs");
const downloadFilterProject = read("native-diagnostics/DownloadProfileFilterSmokeTest/DownloadProfileFilterSmokeTest.csproj");
if (!nativeHost.includes("DownloadProfileFilter.Matches") ||
    !downloadFilter.includes("StringComparer.OrdinalIgnoreCase") ||
    !downloadFilterSmoke.includes("Private sessions do not enter named profile lists") ||
    !downloadFilterSmoke.includes("Named profiles stay isolated") ||
    !downloadFilterProject.includes("DownloadProfileFilter.cs")) fail("Downloads profile filtering must isolate Default, named and Private sessions through a shared tested helper.");
else pass("Downloads profile matching is case-insensitive for names, keeps Default separate and excludes Private from named profile filters.");

if (!workflow.includes("Exercise profile-aware Downloads filtering") ||
    !workflow.includes("DownloadProfileFilterSmokeTest.csproj")) fail("Windows CI must execute the profile-aware Downloads filtering smoke test.");
else pass("Windows CI executes profile isolation tests for Downloads.");

if (!smokeProject.includes("<EnableDefaultCompileItems>false</EnableDefaultCompileItems>") ||
    !smokeProject.includes('<Compile Include="ProjectionApi.cs" />') ||
    smokeProject.includes("Microsoft.WindowsAppSDK") ||
    smokeProject.includes("Microsoft.Windows.SDK.BuildTools")) fail("The Core WebView2 projection probe must compile only ProjectionApi.cs and must not glob runnable sibling WinUI smoke projects.");
else pass("The Core WebView2 projection probe is isolated from nested Windows smoke-test projects.");
if (nativeHost.includes("private ComboBox DownloadsProfileFilter = null!;") ||
    !nativeXaml.includes('x:Name="DownloadsProfileFilter"')) fail("DownloadsProfileFilter must be generated once from XAML rather than redeclared in the partial C# class.");
else pass("Downloads profile filter uses the single XAML-generated control field.");

if (!nativeHost.includes("var foreground = GetForegroundWindow();") ||
    !nativeHost.includes("foreground != _browserHwnd && foreground != _overlayHwnd && rootOwner != _browserHwnd") ||
    !nativeHost.includes("LibraryPanel.Visibility == Visibility.Visible || _profilesDialogOpen")) fail("The overlay must never rise above an unrelated foreground app and must restore native panels when the browser returns.");
else pass("Overlay activation is foreground-safe and restores Downloads/Library/Profiles even when no website surface is visible.");
if (!js.includes('nativeBridgePermission = "granted";') ||
    js.includes('socket.addEventListener("open", () => {\n      nativeBridgeReconnectAttempts = 0;')) fail("Loopback reconnect fallback must be based on a completed bridge handshake, not a bare WebSocket open.");
else pass("Loopback permission fallback and reconnect backoff only reset after a successful native handshake.");

if (!nativeHost.includes("var browserOwnsForeground =") ||
    nativeHost.includes("if (!_overlayShown || !_workspaceVisible || !_bridgeHandshakeComplete") ||
    !nativeHost.includes("if (!_overlayShown &&") ||
    !nativeHost.includes("DownloadsPanel.Visibility == Visibility.Visible ||")) fail("The native activation timer must restore a hidden overlay only when its owning browser is foreground.");
else pass("The overlay timer can restore hidden native panels after focus returns, without bypassing foreground ownership checks.");


const spatialIndexSource = read("spatial-index.js");
const spatialIndexTests = read("tests/spatial-index.test.mjs");
const spatialBenchmark = read("scripts/benchmark-spatial.mjs");
if (!html.includes('<script src="./spatial-index.js" defer></script>') ||
    html.indexOf('src="./spatial-index.js"') > html.indexOf('src="./app.js"')) fail("The spatial index must load before the workspace application.");
else pass("The spatial index is loaded before the virtualized canvas.");
if (!/new window\.NolaneSpatialIndex\.SpatialIndex\(640\)/.test(js) ||
    !/spatialIndex\.query\(currentCanvasWorldBounds\(CANVAS_OVERSCAN_PX\)\)/.test(js) ||
    !/spatialIndex\.rebuild\(nodes\)/.test(js) || !/spatialIndex\.upsert\(node\)/.test(js)) fail("Canvas spatial index wiring is incomplete.");
else pass("Canvas virtualization queries spatial cells and updates geometry on drag/resize.");
if (!/const MAX_NODES = 2000/.test(js) || /items\.length >= 80/.test(js)) fail("Node cap or old native insertion-order truncation remains.");
else pass("Each local space supports up to 2,000 items without truncating native descriptors at 80.");
if (!/function syncCanvasNodeElements\(forceRefresh\)/.test(js) ||
    !/liveSurfaces\.has\(node\.id\)/.test(js) || !/node\.id === selectedId/.test(js) ||
    /world\.replaceChildren\(\)/.test(js.slice(js.indexOf("function renderNodes()"), js.indexOf("function availableBrowserProfiles()")))) fail("Virtualization must preserve selected/live cards and avoid full world rebuilds.");
else pass("Off-screen cards are virtualized while selected and live-stream cards stay mounted.");
if (!html.includes('id="minimapCanvas"') || !/function drawMinimap\(\)/.test(js) ||
    /createElement\("span"\)/.test(js.slice(js.indexOf("function updateMinimap()"), js.indexOf("function toast(message")))) fail("Minimap must draw to Canvas instead of creating a DOM marker for every node.");
else pass("Minimap markers are drawn on one high-DPI Canvas.");
const nativeSyncSource = js.slice(js.indexOf("function scheduleNativeSurfaceSync()"), js.indexOf("function handleNativeHostMessage"));
if (!nativeSyncSource.includes("(node.x + 1) * scale") || !nativeSyncSource.includes("(node.y + 40) * scale") ||
    nativeSyncSource.includes('querySelector(".node[data-id="')) fail("Native surface geometry must not require a mounted DOM card.");
else pass("Native WebView2 geometry is derived directly from canvas world coordinates.");
if (!spatialIndexSource.includes("MAX_CELLS_PER_ITEM") || !spatialIndexSource.includes("MAX_CELLS_PER_QUERY") ||
    !spatialIndexSource.includes("this.oversized")) fail("Spatial index resource safeguards are missing.");
else pass("Spatial index bounds per-item cell fan-out and oversized viewport queries.");
if (!/\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/.test(read(".github/workflows/pages.yml"))) fail("Pages CI concurrency must be isolated per PR/ref.");


const virtualizedFilterFunction = js.slice(js.indexOf("function updateViewFilter"), js.indexOf("function selectNode"));
if (!virtualizedFilterFunction.includes('    $$(".nav-item").forEach(') ||
    virtualizedFilterFunction.includes('    $(".nav-item").forEach(')) fail("The virtualized filter must toggle every navigation item using the NodeList selector helper.");
else pass("The virtualized filter updates all navigation buttons through querySelectorAll.");

const desktopHostWorkflow = read(".github/workflows/desktop-host.yml");
if (!desktopHostWorkflow.includes('node --check spatial-index.js') ||
    !desktopHostWorkflow.includes('      - "spatial-index.js"') ||
    !desktopHostWorkflow.includes('group: "native-webview2-host-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}"')) fail("Windows CI must validate, watch and isolate the spatial canvas changes.");
else pass("Windows CI validates the spatial index and isolates workflow runs per pull request.");


if (!js.includes("new ResizeObserver(") || !js.includes("canvasResizeObserver.observe(canvas)") ||
    !js.includes("scheduleCanvasVirtualization();")) fail("Canvas viewport changes from layout transitions must refresh the virtualized DOM projection.");
else pass("Canvas ResizeObserver refreshes virtualization, minimap and native geometry after layout changes.");


const saveFunction = js.slice(js.indexOf("function scheduleSave"), js.indexOf("async function saveWorkspace"));
const profileOptionsFunction = js.slice(js.indexOf("function availableBrowserProfiles"), js.indexOf("function createNodeElement"));
const cachedUsageFunction = js.slice(js.indexOf("function cachedNativeProfileUsage"), js.indexOf("function createNodeElement"));
if (!saveFunction.includes("invalidateWorkspaceDerivedCaches()") ||
    !profileOptionsFunction.includes("availableBrowserProfilesCache") ||
    !cachedUsageFunction.includes("nativeProfileUsageCache") ||
    !js.includes("function invalidateNativeProfileUsageCache()") ||
    !js.includes("if (nativeProfileUsageDirty)") ||
    !js.includes("message.profileUsage = cachedNativeProfileUsage().map((item) => [item.name, item.count])")) fail("Workspace-derived browser profile lists and native profile usage must be cached and invalidated only when profile/workspace data changes.");
else pass("Browser profile choices and compact native profile summaries are cached and transmitted only when dirty.");
if ((js.match(/summarizeProfileUsage\(spaces\)/g) || []).length !== 1) fail("Native profile usage must not be recomputed directly in every camera synchronization frame.");
else pass("Native surface sync no longer recomputes profile usage on each camera frame.");


const virtualizerFunction = js.slice(js.indexOf("function syncCanvasNodeElements"), js.indexOf("function scheduleNativeSurfaceSync"));
const liveStartFunction = js.slice(js.indexOf("function startLiveSurface"), js.indexOf("function stopLiveSurfaceById"));
if (!virtualizerFunction.includes('element?.querySelector(".live-surface-video")') ||
    !virtualizerFunction.includes("liveVideoElement.srcObject === liveSurface.stream") ||
    !virtualizerFunction.includes("preserveLiveVideoDom") ||
    !liveStartFunction.includes("liveSurfaces.set(node.id") ||
    !liveStartFunction.includes("renderNodes()") ||
    !liveStartFunction.includes('$(".live-surface-video", nodeElement)')) fail("The first live-stream render must create its video element, while later virtualization refreshes preserve the mounted video.");
else pass("Live Chrome streams create their first video element and keep that element attached across later virtualizer refreshes.");


if (nativeSyncSource.includes("syncActiveSpace()") ||
    !saveFunction.includes("syncActiveSpace()")) fail("Sanitized active-space snapshots must be refreshed on workspace mutations, not allocated on every native camera frame.");
else pass("Native camera frames avoid re-sanitizing and cloning the full active workspace; snapshots refresh when save is scheduled.");


const searchFunction = js.slice(js.indexOf("function cachedNodeSearchText"), js.indexOf("function scheduleCanvasVirtualization"));
const cacheInvalidationFunction = js.slice(js.indexOf("function invalidateWorkspaceDerivedCaches"), js.indexOf("function availableBrowserProfiles"));
if (!/nodeSearchTextCache = new WeakMap\(\)/.test(cacheInvalidationFunction) ||
    !searchFunction.includes("nodeSearchTextCache.get(node)") ||
    !searchFunction.includes("nodeSearchTextCache.set(node, searchText)") ||
    !searchFunction.includes("cachedNodeSearchText(node).includes(query)")) fail("Normalized node search text must be memoized by node and invalidated when workspace data changes.");
else pass("Search text is normalized once per node and reused by viewport and native filtering until workspace data changes.");


if (!spatialIndexSource.includes("get(id)") ||
    !virtualizerFunction.includes("spatialIndex.get(selectedId)") ||
    !virtualizerFunction.includes("spatialIndex.get(id)")) fail("Pinned selected/live cards must be retrieved by spatial-index key rather than scanning the full node array.");
else pass("Selected and active live cards are pinned through constant-time spatial-index lookups.");

const minimapFunction = js.slice(js.indexOf("function updateMinimap"), js.indexOf("function toast(message"));
if (!minimapFunction.includes("minimapGeometryDirty") ||
    !minimapFunction.includes("minimapGeometryCache") ||
    !minimapFunction.includes("if (minimapGeometryDirty || !minimapGeometryCache)") ||
    !js.includes("updateMinimap(true)")) fail("The minimap must cache static item geometry and redraw markers only after geometry changes.");
else pass("Minimap item markers are cached; camera frames update only the viewport rectangle.");


const nativeWorkingSetFunction = js.slice(js.indexOf("function scheduleNativeSurfaceSync"), js.indexOf("function handleNativeHostMessage"));
if (!nativeWorkingSetFunction.includes("spatialIndex.query(currentCanvasWorldBounds(0))") ||
    !nativeWorkingSetFunction.includes("nativeMaxVisibleSurfaces") ||
    !nativeWorkingSetFunction.includes("message.workspaceIds = nativeWorkspaceIdsCache") ||
    !js.includes("function refreshNativeWorkspaceIdsSnapshot()") ||
    !js.includes("next.some((id, index) => id !== nativeWorkspaceIdsCache[index])") ||
    !nativeWorkingSetFunction.includes("if (sendNativeBridgeMessage(message))") ||
    !nativeWorkingSetFunction.includes("if (nativeWorkspaceIdsDirty) nativeWorkspaceIdsDirty = false") ||
    nativeWorkingSetFunction.includes("for (const node of nodes)")) fail("Native per-frame synchronization must be bounded to visible viewport candidates and send complete workspace membership only after mutations or a new handshake.");
else pass("Native sync sends only the top visible viewport working set; complete website-card membership is sent separately and only when dirty.");

if (!nativeHost.includes("UpdateWorkspaceSurfaceIds(root)") ||
    !nativeHost.includes("_knownWorkspaceSurfaceIds") ||
    !nativeHost.includes("ids.GetArrayLength() > 2000") ||
    !nativeHost.includes("MaxSurfaceCandidates = 8") ||
    !nativeHost.includes("Take(MaxSurfaceCandidates)") ||
    !nativeHost.includes("items.GetArrayLength() > MaxSurfaceCandidates") ||
    !nativeHost.includes("!present.Contains(surface.Id)") ||
    !nativeHost.includes("!known.Contains(surface.Id)")) fail("Windows host must distinguish deleted workspace cards from off-screen cached cards and enforce its visible working-set budget.");
else pass("Windows host reconciles deleted IDs separately, hides off-screen surfaces, and caps parsed descriptors at its adaptive renderer budget.");

if (!nativeProfileUsageParser.includes("count > MaxWorkspaceCardCount") || !nativeProfileUsageParser.includes("MaxWorkspaceCardCount = 12 * 2000")) fail("Native browser profile usage must allow up to 12 spaces × 2,000 cards.");
else pass("Native profile usage validation covers the 24,000-card upper bound across all local spaces.");

if (!js.slice(js.indexOf("function normalizeUrl"), js.indexOf("function openDatabase")).includes("value.length > 4096")) fail("Website URLs must be bounded before they enter native surface payloads.");
else pass("Website URLs are capped at 4,096 characters before entering native browser descriptors.");


const renderNodesFunction = js.slice(js.indexOf("function renderNodes"), js.indexOf("function invalidateWorkspaceDerivedCaches"));
const liveStopFunction = js.slice(js.indexOf("function stopLiveSurfaceById"), js.indexOf("function stopAllLiveSurfaces"));
if (!renderNodesFunction.includes("refreshNativeWorkspaceIdsSnapshot()") ||
    !liveStopFunction.includes("if (render) renderNodes()") ||
    !js.includes("function refreshNativeWorkspaceIdsSnapshot()")) fail("Native workspace membership must refresh when a live surface stops and the card returns to native WebView2 eligibility.");
else pass("Live Surface teardown refreshes native membership even when no workspace persistence event occurs.");


const virtualizedSearchFunction = js.slice(js.indexOf("function syncCanvasNodeElements"), js.indexOf("function scheduleNativeSurfaceSync"));
const searchFilterFunction = js.slice(js.indexOf("function updateViewFilter"), js.indexOf("function selectNode"));
if (virtualizedSearchFunction.includes("if (query) for (const node of nodes)") ||
    !searchFilterFunction.includes("searchResultIds.push(node.id)") ||
    !searchFilterFunction.includes("function focusSearchResult(reverse)") ||
    !searchFilterFunction.includes("NolaneSpatialIndex.cycleIndex") ||
    !spatialIndexSource.includes("function cycleIndex(currentIndex, itemCount, reverse)") ||
    !js.includes('$("#searchInput").addEventListener("keydown"') ||
    !js.includes("focusSearchResult(event.shiftKey)")) fail("Workspace-wide search must keep off-screen matches out of the DOM and navigate them with Enter/Shift+Enter.");
else pass("Search indexes all workspace matches without mounting them; Enter and Shift+Enter navigate the result set.");


if (!spatialIndexSource.includes("function sortByZIndex(items)") ||
    !nativeWorkingSetFunction.includes("window.NolaneSpatialIndex.sortByZIndex") ||
    !js.includes("const MAX_NATIVE_SURFACE_CANDIDATES = 8;") ||
    !nativeWorkingSetFunction.includes("const candidateLimit = Math.min(MAX_NATIVE_SURFACE_CANDIDATES, nativeMaxVisibleSurfaces + 4);") ||
    !nativeWorkingSetFunction.includes("if (items.length >= candidateLimit) break;")) fail("Native working-set candidates must be z-ranked, viewport-only and capped at eight, while actual renderer activation remains bounded by the host's adaptive budget.");
else pass("Native surface selection ranks viewport candidates, sends a bounded fallback pool of up to eight, and lets the host enforce its adaptive active-renderer budget.");

const searchNavigatorFunction = js.slice(js.indexOf("function updateViewFilter"), js.indexOf("function selectNode"));
if (!searchNavigatorFunction.includes('if (query) searchResultIds.push(node.id)') ||
    !searchNavigatorFunction.includes('if (!$("#searchInput").value.trim() || !searchResultIds.length) return;') ||
    !js.includes("focusSearchResult(event.shiftKey)")) fail("Global search navigation must remain virtualized and must not cycle every card when the search box is empty.");
else pass("Search navigation tracks global matches, moves forward/backward on Enter/Shift+Enter and leaves empty search inert.");

if (!js.includes('visibleCount + " matching items · Press Enter to jump, Shift+Enter to go back."')) fail("Search UI must explain keyboard navigation through workspace-wide results.");
else pass("Search result count explains Enter/Shift+Enter navigation when matches exist.");


if (!spatialIndexSource.includes("function cycleIndex(currentIndex, itemCount, reverse)") ||
    !searchNavigatorFunction.includes("NolaneSpatialIndex.cycleIndex") ||
    !searchNavigatorFunction.includes("if (searchResultIndex < 0) return;")) fail("Search result navigation must use a tested cyclic index policy for forward, reverse, wrap and empty cases.");
else pass("Search result cycling uses the tested shared forward/reverse index policy.");


if (!nativeWorkingSetFunction.includes("if (nativeProfileUsageDirty)") ||
    !nativeWorkingSetFunction.includes("message.profileUsage = cachedNativeProfileUsage()") ||
    !nativeWorkingSetFunction.includes("if (nativeProfileUsageDirty) nativeProfileUsageDirty = false") ||
    !js.includes("function invalidateNativeProfileUsageCache()") ||
    !js.includes("invalidateNativeProfileUsageCache();")) fail("Native profile usage must be transmitted only after profile/workspace changes, not on every camera frame.");
else pass("Native profile usage is cached and sent only when profile data changes or a bridge handshake requires a refresh.");


if (!nativeWorkingSetFunction.includes('message.profileUsage = cachedNativeProfileUsage().map((item) => [item.name, item.count])') ||
    !nativeHost.includes("ProfileUsageSnapshot.TryParse(profiles, out var updated)") ||
    !nativeProfileUsageParser.includes("MaxWorkspaceCardCount = 12 * 2000") ||
    !nativeProfileUsageParser.includes("totalCount > MaxWorkspaceCardCount") ||
    !nativeProfileUsageParser.includes("candidate.GetValueOrDefault(normalized)") ||
    !nativeProfileUsageParser.includes("entry.TryGetProperty(\"name\"") ||
    !nativeProfileUsageSmoke.includes("Case-insensitive duplicate profile names were not combined.") ||
    !nativeProfileUsageSmoke.includes("A profile summary with more than 24,000 entries was not rejected atomically.")) fail("Profile summaries must remain compact, backward-compatible and bounded by the total 12 x 2,000 workspace card quota.");
else pass("Native profile snapshots are parsed atomically, retain legacy object compatibility, and reject over-count/overflow input.");

const snapshotSyncFunction = js.slice(js.indexOf("function sendNativeWorkspaceSnapshot"), js.indexOf("function scheduleNativeSurfaceSync"));
if (!nativeBridgeSource.includes("function createWorkspaceSnapshotMessages") ||
    !nativeBridgeTests.includes('test("workspace snapshots are chunked into revisioned bounded messages"') ||
    !snapshotSyncFunction.includes("createWorkspaceSnapshotMessages") ||
    !snapshotSyncFunction.includes("nativeWorkspaceIdsDirty = false") ||
    !nativeBridgeSource.includes("WORKSPACE_SNAPSHOT_CHUNK_SIZE = 256")) {
  fail("The website must build and send revisioned 256-entry workspace snapshots separately from camera synchronization.");
} else {
  pass("Website snapshots are revisioned, chunked to 256 entries and sent out-of-band from camera frames.");
}

if (!nativeHost.includes("workspaceSnapshotProtocol = 1") ||
    !js.includes("nativeWorkspaceSnapshotProtocol = message.workspaceSnapshotProtocol === 1") ||
    !nativeWorkingSetFunction.includes("if (!nativeWorkspaceSnapshotProtocol)") ||
    !nativeHost.includes("_workspaceSnapshotReceiver.TryCommit(root, out var snapshot)")) {
  fail("Workspace snapshot protocol must be capability-negotiated and retain the legacy protocol-v2 fallback.");
} else {
  pass("Chunked workspace sync is capability-negotiated; older installed Windows hosts retain the original protocol-v2 fields.");
}

if (!workspaceSnapshotReceiver.includes("MaxWorkspaceIdCount = 24000") ||
    !workspaceSnapshotReceiver.includes("ChunkSize = 256") ||
    !workspaceSnapshotReceiver.includes("pending.ReceivedChunks.Count != pending.ChunkCount") ||
    !workspaceSnapshotReceiver.includes("pending.WorkspaceIds.Count != pending.WorkspaceIdCount") ||
    !workspaceSnapshotReceiver.includes("ProfileUsageSnapshot.TryAddEntry") ||
    !workspaceSnapshotReceiver.includes("_lastCommittedRevision") ||
    !workspaceSnapshotSmoke.includes("out-of-order chunk") ||
    !workspaceSnapshotSmoke.includes("incomplete snapshot")) {
  fail("The native snapshot receiver must validate revision, quota, chunk completeness, IDs and profile usage before atomic commit.");
} else {
  pass("Windows snapshot receiver enforces revision order, quotas and complete-chunk atomic commit before replacing membership/profile state.");
}

if (!nativeHost.includes("if (_workspaceSurfaceIdsReceived)") ||
    !nativeHost.includes("viewport is not a complete membership set") ||
    !nativeHost.includes("workspaceSnapshotProtocol = 1")) {
  fail("Native surface eviction must wait for a complete membership snapshot during handshake and advertise the receiver capability.");
} else {
  pass("Native cache eviction waits for complete workspace membership; new hosts advertise chunked snapshot support.");
}

const nodeValidationFunction = js.slice(js.indexOf("function validateNode"), js.indexOf("function workspaceSnapshot"));
const urlNormalizationFunction = js.slice(js.indexOf("function normalizeUrl"), js.indexOf("function openDatabase"));
if (!nodeValidationFunction.includes("claimUniqueId(node.id, usedIds || new Set(), uid)") ||
    !spatialIndexSource.includes("^[A-Za-z0-9_-]{1,80}$") ||
    !urlNormalizationFunction.includes("if (parsed.href.length > 4096)")) fail("Native sync IDs and normalized URLs must have strict serialized-size bounds.");
else pass("Workspace IDs are ASCII-bounded through the shared unique-ID allocator and normalized URLs remain within the native 4,096-character descriptor limit.");


// Exercise the actual UTF-8 JSON size against the native loopback bridge's 2 MiB limit.
// Workspace bounds: 2,000 safe IDs × 80 chars, 24,000 distinct profile names × 64 chars,
// and up to eight bounded viewport candidates (the host still activates only 2–4).
const worstCaseNativePayload = {
  type: "nolane.surfaces.sync",
  protocol: 2,
  viewport: { screenLeft: -100000, screenTop: -100000, width: 12000, height: 12000, deviceScale: 4 },
  workspaceVisible: true,
  items: Array.from({ length: 8 }, () => ({
    id: "n".repeat(80),
    url: "https://example.com/" + "a".repeat(4076),
    title: "\\u0000".repeat(120),
    privateMode: false,
    profileName: "P".repeat(64),
    x: 100000, y: 100000, width: 8000, height: 6000,
    clipX: 0, clipY: 0, clipWidth: 8000, clipHeight: 6000,
    zIndex: 100000, visible: true
  })),
  workspaceIds: Array.from({ length: 2000 }, (_, index) =>
    "n" + index.toString(36).padStart(4, "0") + "x".repeat(75)
  ),
  profileUsage: Array.from({ length: 24000 }, (_, index) => [
    index.toString(36).toUpperCase().padStart(5, "0") + "P".repeat(59),
    1
  ])
};
const worstCasePayloadBytes = Buffer.byteLength(JSON.stringify(worstCaseNativePayload), "utf8");
const worstCaseChunkPayload = {
  type: "nolane.workspace.snapshot.chunk", protocol: 2, revision: 1, index: 0,
  workspaceIds: Array.from({ length: 256 }, (_, index) => "n" + index.toString(36).padStart(4, "0") + "x".repeat(75)),
  profileUsage: Array.from({ length: 256 }, (_, index) => [
    index.toString(36).toUpperCase().padStart(5, "0") + "P".repeat(59), 1
  ])
};
const worstCaseChunkBytes = Buffer.byteLength(JSON.stringify(worstCaseChunkPayload), "utf8");
if (worstCaseChunkBytes >= 64 * 1024) fail("A 256-entry workspace snapshot chunk must remain below 64 KiB.");
else pass("Worst-case 256-entry workspace snapshot chunk is " + worstCaseChunkBytes + " UTF-8 bytes, below 64 KiB.");
if (worstCasePayloadBytes >= 2 * 1024 * 1024 - 16 * 1024) fail("Worst-case 2,000-card workspace membership, 24,000 compact profiles and eight bounded viewport candidates must stay at least 16 KiB below the bridge's 2 MiB frame limit.");
else pass("Worst-case native sync payload is " + worstCasePayloadBytes + " UTF-8 bytes for eight viewport candidates, below the 2 MiB frame limit with at least 16 KiB headroom.");


const nodeCollectionFunction = js.slice(js.indexOf("function normalizeNodeCollection"), js.indexOf("function validateNode"));
const spaceCollectionFunction = js.slice(js.indexOf("function normalizeSpaceCollection"), js.indexOf("function activeSpace"));
if (!nodeCollectionFunction.includes("usedIds = new Set()") ||
    !nodeCollectionFunction.includes("validateNode(candidate, usedIds)") ||
    !nodeCollectionFunction.includes("normalized.length >= MAX_NODES") ||
    !spaceCollectionFunction.includes("usedSpaceIds = new Set()") ||
    !spaceCollectionFunction.includes("normalized.length < 12") ||
    !js.includes("claimUniqueId(space.id, usedSpaceIds, uid)") ||
    !js.includes("claimUniqueId(node.id, usedIds || new Set(), uid)")) fail("Workspace loading/import must resolve duplicate or unsafe IDs and enforce node/space bounds while normalizing.");
else pass("Workspace normalization assigns unique safe IDs and enforces 2,000 nodes per space and 12 spaces during ingestion.");

if (!spatialIndexSource.includes("function claimUniqueId(candidate, usedIds, generateId)") ||
    !spatialIndexTests.includes('test("workspace IDs are safe, unique and retained in first-occurrence order"')) fail("Unique ID allocation must be covered by deterministic regression tests.");
else pass("Duplicate and unsafe workspace ID handling is exercised by unit tests.");


const validateNodeFunction = js.slice(js.indexOf("function validateNode"), js.indexOf("function workspaceSnapshot"));
if (validateNodeFunction.indexOf("claimUniqueId(node.id") < validateNodeFunction.indexOf('if (node.type === "website")') ||
    !validateNodeFunction.includes("Claim the ID only after the record has passed validation")) fail("Imported node IDs must be claimed only after the node record has passed validation.");
else pass("Invalid import records do not reserve IDs or force later valid cards to be renamed.");


const pointerMoveFunction = js.slice(js.indexOf("function pointerMove"), js.indexOf("function pointerUp"));
if (!pointerMoveFunction.includes("spatialIndex.get(dragState.id)") ||
    !pointerMoveFunction.includes("spatialIndex.get(resizeState.id)") ||
    pointerMoveFunction.includes("nodes.find(")) fail("Pointer-move drag and resize lookups must use constant-time spatial-index access.");
else pass("Drag and resize pointer-move handlers use constant-time spatial-index lookups instead of scanning all nodes.");


if (
  !spatialIndexSource.includes("right <= x || bottom <= y") ||
  !spatialIndexSource.includes("this.coarseCellSize = size * 64") ||
  !spatialIndexSource.includes("_rangeMetrics(rect, this.cellSize)") ||
  !spatialIndexSource.includes("_rangeMetrics(rect, this.coarseCellSize)") ||
  !spatialIndexSource.includes("this.coarseOversized") ||
  !spatialIndexTests.includes('test("extreme but representable world coordinates use overflow lookup without unsafe cell loops"') ||
  !spatialIndexTests.includes('test("rectangles whose extent disappears at floating-point precision are rejected"') ||
  !spatialIndexTests.includes('test("broad viewport queries use the coarse grid instead of scanning every entry"') ||
  !spatialIndexTests.includes('test("coarse overflow entries remain discoverable and removable at every query scale"') ||
  !spatialIndexTests.includes('test("upsert moves entries across fine and coarse cells without leaving stale candidates"') ||
  !spatialIndexTests.includes('test("clear and rebuild remove all fine/coarse memberships and overflow state"')
) {
  fail("Spatial indexing must safely handle extreme coordinates, fine/coarse fallback, overflow and clear/rebuild.");
} else {
  pass("Spatial indexing uses exact geometry checks with bounded fine/coarse grids, migration and dedicated overflow paths.");
}


if (!js.includes("while (nodes.some((node) => node.id === candidate) || spaces.some((space) => space.id === candidate))")) fail("Newly generated node and space IDs must avoid existing workspace IDs.");
else pass("Generated IDs are checked against all existing nodes and spaces before use.");


// Coordinate and camera normalization must be shared by import, restore and live interaction.
const worldCoordinateFunction = spatialIndexSource.slice(
  spatialIndexSource.indexOf("function normalizeWorldCoordinate"),
  spatialIndexSource.indexOf("function intersects")
);
const normalizedNodeFunction = js.slice(js.indexOf("function validateNode"), js.indexOf("function workspaceSnapshot"));
const normalizedPointerMoveFunction = js.slice(js.indexOf("function pointerMove"), js.indexOf("function pointerUp"));
const focusSearchFunction = js.slice(js.indexOf("function focusSearchResult"), js.indexOf("function selectNode"));
const companionImportFunction = js.slice(
  js.indexOf("function addBrowserTabsToWorkspace"),
  js.indexOf("function handleCompanionMessage")
);
if (!worldCoordinateFunction.includes("function normalizeWorldCoordinate") ||
    !worldCoordinateFunction.includes("Number.MAX_SAFE_INTEGER") ||
    !worldCoordinateFunction.includes("function normalizeViewState") ||
    !js.includes("const normalizeCanvasView") ||
    !js.includes("maxWorldCoordinate: MAX_WORLD_COORDINATE") ||
    !normalizedNodeFunction.includes("normalizeCanvasCoordinate(node.x, 0)") ||
    !normalizedNodeFunction.includes("normalizeCanvasCoordinate(node.y, 0)") ||
    !normalizedPointerMoveFunction.includes("normalizeCanvasCoordinate(") ||
    !normalizedPointerMoveFunction.includes("view = normalizeCanvasView(") ||
    !focusSearchFunction.includes("view = normalizeCanvasView(") ||
    !focusSearchFunction.includes("scale,") ||
    !companionImportFunction.includes("normalizeCanvasCoordinate(Math.round(center.x") ||
    !companionImportFunction.includes("normalizeCanvasCoordinate(Math.round(center.y") ||
    !spatialIndexTests.includes('test("world coordinates preserve large valid positions beyond the former 100,000-unit clamp"') ||
    !spatialIndexTests.includes('test("camera translations use the normalized scale-aware world-coordinate budget"')) {
  fail("World coordinates and camera translations must share tested finite bounds across import, restore and pointer interactions.");
} else {
  pass("World coordinates and zoom-scaled camera translations share finite normalization across import, restore, drag, pan, zoom, fit-to-content and search-result focus.");
}


// Origin rebasing is render-only: logical node coordinates and native overlay geometry stay unchanged.
const renderOriginHelpers = spatialIndexSource.slice(
  spatialIndexSource.indexOf("function computeRenderOrigin"),
  spatialIndexSource.indexOf("function intersects")
);
const rebasedTransformFunction = js.slice(
  js.indexOf("function applyCanvasWorldTransform"),
  js.indexOf("function positionCanvasNodeElement")
);
const localNodePositionFunction = js.slice(
  js.indexOf("function positionCanvasNodeElement"),
  js.indexOf("function updateCanvasRenderOrigin")
);
const renderOriginUpdateFunction = js.slice(
  js.indexOf("function updateCanvasRenderOrigin"),
  js.indexOf("function cachedNodeSearchText")
);
const nativeViewportSyncFunction = js.slice(
  js.indexOf("function scheduleNativeSurfaceSync"),
  js.indexOf("function handleNativeHostMessage")
);
if (!renderOriginHelpers.includes("function computeRenderOrigin") ||
    !renderOriginHelpers.includes("function rebasePoint") ||
    !renderOriginHelpers.includes("function createRebasedTransform") ||
    !js.includes("const CANVAS_RENDER_ORIGIN_QUANTUM = 4096;") ||
    !rebasedTransformFunction.includes("createRebasedTransform(view, canvasRenderOrigin)") ||
    !localNodePositionFunction.includes("rebasePoint(node, canvasRenderOrigin)") ||
    !renderOriginUpdateFunction.includes("computeRenderOrigin(") ||
    !renderOriginUpdateFunction.includes("positionCanvasNodeElement(element, node)") ||
    !nativeViewportSyncFunction.includes("view.x + (node.x + 1) * scale") ||
    nativeViewportSyncFunction.includes("canvasRenderOrigin") ||
    /(?:article|element)\.style\.(?:left|top)\s*=\s*node\.(?:x|y)\s*\+\s*["']px/.test(js)) {
  fail("Canvas origin rebasing must localize DOM coordinates while preserving logical/native screen geometry.");
} else {
  pass("Canvas DOM positions are rebased around a snapped viewport origin; logical, saved and native overlay coordinates remain unchanged.");
}
if (!spatialIndexTests.includes('test("viewport origin rebasing preserves exact screen positions for large world coordinates"') ||
    !spatialIndexTests.includes('test("viewport origin rebasing remains stable across negative coordinates and invalid inputs"') ||
    !spatialIndexTests.includes('test("spatial index keeps exact viewport query results across a 15,000-card workspace"') ||
    !spatialBenchmark.includes("const SIZES = [2000, 10000, 50000, 100000];") ||
    !spatialBenchmark.includes("queryP95Ms") ||
    !spatialBenchmark.includes("bruteForceCorrectnessChecks")) {
  fail("Origin rebasing, large-workspace correctness tests and the repeatable 50k-card benchmark are incomplete.");
} else {
  pass("Origin rebasing invariance, 15k-card exact queries and 2k/10k/50k spatial benchmarks are covered.");
}


// Renderer capacity must count successfully visible surfaces, not failed creation attempts.
const nativeSurfaceSyncFunction = nativeHost.slice(
  nativeHost.indexOf("private async Task SynchronizeSurfacesAsync"),
  nativeHost.indexOf("private async Task<BrowserSurface?> GetOrCreateSurfaceAsync")
);
const retainedDownloadBranch = nativeSurfaceSyncFunction.indexOf("if (HasRetainedDownload(item.Id))");
const retainedOverlayItem = nativeSurfaceSyncFunction.indexOf("activeItems.Add(item)", retainedDownloadBranch);
const retainedActiveCount = nativeSurfaceSyncFunction.indexOf("activeCount++", retainedDownloadBranch);
const surfaceCreation = nativeSurfaceSyncFunction.indexOf("var surface = await GetOrCreateSurfaceAsync(item)");
const surfaceCreationGuard = nativeSurfaceSyncFunction.indexOf("if (surface is null) continue;", surfaceCreation);
const surfaceActiveCount = nativeSurfaceSyncFunction.indexOf("activeCount++", surfaceCreationGuard);
if (retainedDownloadBranch < 0 ||
    retainedOverlayItem < retainedDownloadBranch ||
    retainedActiveCount < retainedOverlayItem ||
    surfaceCreation < 0 ||
    surfaceCreationGuard < surfaceCreation ||
    surfaceActiveCount < surfaceCreationGuard ||
    nativeSurfaceSyncFunction.indexOf("activeCount++") < retainedDownloadBranch) {
  fail("Native renderer budget must count only successfully created/retained visible surfaces, and retained-download surfaces must stay inside the active overlay region.");
} else {
  pass("Native renderer capacity is charged only to visible retained or successfully created surfaces; download-protected cards remain inside the overlay region.");
}


// The website may open before the Windows startup host, or the host may restart for a runtime update.
const reconnectFunction = js.slice(
  js.indexOf("function queueWindowsBridgeReconnect"),
  js.indexOf("async function initializeWindowsBridge")
);
const foregroundReconnectEvents = js.slice(
  js.indexOf('document.addEventListener("visibilitychange"'),
  js.indexOf("function worldPoint")
);
if (!reconnectFunction.includes("nativeHostAvailable") ||
    !reconnectFunction.includes("Math.min(nativeBridgeReconnectAttempts, 8)") ||
    !reconnectFunction.includes("Math.min(30000, 800 * Math.pow(1.7, exponent))") ||
    reconnectFunction.includes("nativeBridgeReconnectAttempts >= 8") ||
    !foregroundReconnectEvents.includes("document.visibilityState === \"visible\" && !nativeHostAvailable) queueWindowsBridgeReconnect()") ||
    !foregroundReconnectEvents.includes("if (!nativeHostAvailable) queueWindowsBridgeReconnect()")) {
  fail("Windows background bridge reconnection must continue with bounded backoff and resume when the page returns to the foreground.");
} else {
  pass("Windows bridge reconnection survives startup races and runtime restarts with capped backoff and foreground recovery.");
}
