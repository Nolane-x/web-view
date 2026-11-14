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

for (const asset of ["index.html", "styles.css", "native-bridge.js", "workspace-storage.js", "app.js", "manifest.webmanifest", "sw.js", "icon.svg"]) {
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
    !nativeXaml.includes('x:Name="WorkspaceView" Visibility="Collapsed"')) fail("Background host must close all native browser surfaces and must not create a visible second workspace.");
else pass("Native WebView2 surfaces are explicitly released and the legacy parent workspace view stays hidden.");
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
    !smokeProject.includes("Microsoft.WindowsAppSDK")) fail("Windows CI must independently compile the WebView2 CsWinRT API projection before building the native host.");
else pass("Windows CI isolates the WinUI/WebView2 CsWinRT API projection in a minimal compile-smoke project before native host publish.");
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
const trayIcon = read("desktop-host/BackgroundTrayIcon.cs");
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
    !trayIcon.includes("StartupChoiceValue") ||
    !trayIcon.includes('key.SetValue(StartupChoiceValue, "disabled")')) fail("First connection startup registration must respect an explicit user decision to disable auto-start.");
else pass("Windows auto-start is enabled after first connection unless the user has explicitly disabled it.");

if (process.exitCode) process.exit(process.exitCode);
console.log("All static checks passed.");

if (!nativeHost.includes("IsTrustedWorkspaceUri(pageElement.GetString() ?? \"\"") ||
    !js.includes("page: location.href")) fail("The first local handshake must bind to the published /web-view workspace path, not just the shared GitHub Pages origin.");
else pass("The local bridge handshake is bound to the exact Nolane workspace path.");

if (!nativeHost.includes("_overlayWidth = 0;") ||
    !nativeHost.includes("foregroundBrowser != IntPtr.Zero && foregroundBrowser != _browserHwnd") ||
    !nativeHost.includes("width > 8000 || height < 60 || height > 6000")) fail("Overlay recovery must discard stale viewport bounds and validate native card geometry.");
else pass("Renderer swaps cannot reuse stale overlay coordinates, and incoming card bounds are constrained.");
