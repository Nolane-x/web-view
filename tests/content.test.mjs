import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const app = read("../app.js");
const bridge = read("../native-bridge.js");
const readme = read("../README.md");

test("the published workspace loads the native Windows bridge before the workspace app", () => {
  const nativeBridgePosition = html.indexOf('<script src="./native-bridge.js" defer></script>');
  const storagePosition = html.indexOf('<script src="./workspace-storage.js" defer></script>');
  const appPosition = html.indexOf('<script src="./app.js" defer></script>');
  assert.ok(nativeBridgePosition >= 0);
  assert.ok(storagePosition > nativeBridgePosition);
  assert.ok(appPosition > storagePosition);
  assert.match(html, /id="connectWindowsBridgeButton"/);
});

test("the web workspace connects only to the local Windows WebView2 host protocol", () => {
  assert.match(app, /new WebSocket\("ws:\/\/127\.0\.0\.1:43172\/bridge", "nolane\.infinite\.v2"\)/);
  assert.match(app, /type: "nolane\.bridge\.hello"/);
  assert.match(app, /function scheduleNativeSurfaceSync\(\)/);
  assert.match(bridge, /function createWorkspaceSnapshotMessages/);
});

test("workspace search and card selection handlers remain present after the native-runtime migration", () => {
  const filterStart = app.indexOf("function updateViewFilter()");
  const selectionStart = app.indexOf("function selectNode(id)");
  const actionStart = app.indexOf("function handleNodeAction(event)");
  assert.ok(filterStart >= 0);
  assert.ok(selectionStart > filterStart);
  assert.ok(actionStart > selectionStart);
  const filterAndSearch = app.slice(filterStart, selectionStart);
  const selection = app.slice(selectionStart, actionStart);
  assert.match(filterAndSearch, /scheduleCanvasVirtualization\(\)/);
  assert.match(filterAndSearch, /scheduleNativeSurfaceSync\(\)/);
  assert.match(selection, /scheduleNativeSurfaceSync\(\)/);
});

test("retired Chrome capture and extension messaging are not shipped in the web app", () => {
  assert.doesNotMatch(app, /chrome\.tabCapture|chrome\.debugger|LIVE_SURFACE|NOLANE_START_LIVE_SURFACE|handleCompanionMessage|browserTabId|browserWindowId|browserSessionId/);
  assert.doesNotMatch(html, /extension\/(?:manifest|popup|background)/);
});

test("product setup documents the background Windows host as the sole native browser runtime", () => {
  assert.match(readme, /Windows background bridge/);
  assert.match(readme, /There is no Chrome extension, tab-capture, or debugger integration/);
  assert.match(readme, /WebView2 uses its own local profiles/);
});
