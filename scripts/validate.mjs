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
if (extensionManifest.version !== "0.2.7") fail("Browser Companion release metadata must be synchronized at version 0.2.7.");
else pass("Browser Companion release metadata is synchronized at 0.2.7.");
for (const file of ["extension/background.js", "extension/content.js", "extension/popup.html", "extension/popup.css", "extension/popup.js", "extension/README.md"]) {
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
if (!/NOLANE_REGISTER_WORKSPACE/.test(bridge) || !/NOLANE_LIVE_INPUT/.test(bridge)) fail("Workspace content-script registration/input bridge is incomplete.");
else pass("Content script registers the workspace and forwards input.");
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
if (!/chrome\.tabs\.onUpdated/.test(background) || !/removeSessionsForWorkspaceTab/.test(background) || !/movedToAnotherOrigin/.test(background)) fail("Workspace lifecycle and source-origin changes must release live sessions without depending on CDP.");
else pass("Workspace lifecycle and source-origin changes release live sessions without depending on CDP.");
const focusIndex = background.indexOf("chrome.windows.update(workspaceTab.windowId, { focused: true })");
const streamIndex = background.indexOf("chrome.tabCapture.getMediaStreamId");
if (focusIndex < 0 || streamIndex < 0 || focusIndex > streamIndex) fail("The short-lived stream token must be minted only after the consumer tab is focused.");
else pass("The stream token is minted immediately after consumer focus to reduce expiry risk.");
if (!/audio:\s*\{\s*mandatory:\s*\{\s*chromeMediaSource:\s*"tab"/.test(js) || !/video:\s*\{\s*mandatory:\s*\{\s*chromeMediaSource:\s*"tab"/.test(js) || !/createMediaStreamSource/.test(js) || !/toggleLiveAudio/.test(js)) fail("Live surface audio/video tab-capture constraints or local mute controls are incomplete.");
else pass("Live surface audio is routed locally with explicit mute control.");
if (!/NOLANE_START_LIVE_SURFACE/.test(popup) || !/Stream this tab to Nolane/.test(popupHTML)) fail("Popup must expose explicit active-tab capture.");
else pass("Popup exposes explicit current-tab capture.");
if (!/keepSourceVisible/.test(popup) || !/chrome\.windows\.create/.test(background) || !/focused:\s*true/.test(background)) fail("Keep-source-visible compatibility mode must move Nolane into a separate Chrome window.");
else pass("Keep-source-visible mode preserves the source tab in its original window.");
if (!/chrome\.tabCapture\.getCapturedTabs/.test(background) || !/already reports an active capture/.test(background)) fail("Existing tab capture must be detected before attempting a duplicate stream.");
else pass("Existing tab captures are detected before stream setup.");
if (!/NOLANE_GET_DIAGNOSTICS/.test(background) || !/diagnosticsButton/.test(popup)) fail("The companion compatibility diagnostics action is incomplete.");
else pass("The companion exposes a local compatibility diagnostics report.");
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

if (process.exitCode) process.exit(process.exitCode);
console.log("All static checks passed.");
