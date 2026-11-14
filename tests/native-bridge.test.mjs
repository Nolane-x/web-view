import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, URL, Set, Object, String }, { filename: "native-bridge.js" });
const bridge = window.NolaneNativeBridge;

test("native browser commands use a versioned allow-listed protocol", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.createCommand("node-1", "back"))), {
    type: "nolane.surface.command", protocol: 2, id: "node-1", action: "back"
  });
  assert.equal(bridge.createCommand("node-1", "execute-script"), null);
  assert.equal(bridge.createCommand("", "reload"), null);
  assert.equal(bridge.createCommand("x".repeat(129), "reload"), null);
});

test("native surface state accepts only the expected message and safe web URLs", () => {
  assert.equal(bridge.normalizeSurfaceState({ type: "other", id: "a", state: "ready" }), null);
  const value = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "surface-2", state: "ready",
    url: "https://example.com/path", title: "Example", canGoBack: true,
    canGoForward: false, isMuted: true, isPlayingAudio: false
  });
  assert.equal(value.url, "https://example.com/path");
  assert.equal(value.canGoBack, true);
  assert.equal(value.isMuted, true);
  assert.equal(value.isPlayingAudio, false);
});

test("native surface state rejects credentials and non-web schemes", () => {
  for (const url of ["javascript:alert(1)", "file:///C:/secret.txt", "https://user:pass@example.com/"]) {
    const value = bridge.normalizeSurfaceState({ type: "nolane.native.surface", id: "a", state: "ready", url });
    assert.equal(value.url, null);
  }
});

test("native surface state is bounded and coerces unknown values safely", () => {
  const value = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "a", state: "surprise",
    detail: "d".repeat(400), title: "t".repeat(200),
    canGoBack: "true", canGoForward: 1, isMuted: 1
  });
  assert.equal(value.state, "error");
  assert.equal(value.detail.length, 240);
  assert.equal(value.title.length, 160);
  assert.equal(value.canGoBack, false);
  assert.equal(value.canGoForward, false);
  assert.equal(value.isMuted, false);
});

test("native address bar creates normalized HTTP and HTTPS navigation commands", () => {
  const https = bridge.createNavigationCommand("node-7", "example.com/a b");
  assert.equal(https.action, "navigate");
  assert.equal(https.url, "https://example.com/a%20b");
  const http = bridge.createNavigationCommand("node-7", "http://localhost:3000/");
  assert.equal(http.url, "http://localhost:3000/");
});

test("native address bar rejects unsafe schemes, credentials and oversized URLs", () => {
  for (const url of ["javascript:alert(1)", "file:///C:/secret", "https://user:pass@example.com/", ""]) {
    assert.equal(bridge.createNavigationCommand("node-7", url), null);
  }
  assert.equal(bridge.createNavigationCommand("node-7", "a".repeat(4097)), null);
});


test("native browser bridge allows bookmark toggles and normalizes saved state", () => {
  assert.equal(bridge.createCommand("node-5", "toggle-bookmark").action, "toggle-bookmark");
  const state = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "node-5", state: "ready", isBookmarked: true
  });
  assert.equal(state.isBookmarked, true);
});

test("profile usage counts website cards across all saved spaces, including duplicate IDs", () => {
  const usage = bridge.summarizeProfileUsage([
    { id: "one", nodes: [
      { id: "shared", type: "website", browserProfile: " Work " },
      { id: "note", type: "note", browserProfile: "Work" },
      { id: "default-1", type: "website" }
    ] },
    { id: "two", nodes: [
      { id: "shared", type: "website", browserProfile: "Work" },
      { id: "personal", type: "website", browserProfile: "Personal" }
    ] },
    { id: "malformed", nodes: null },
    null
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(usage)), [
    { name: "", count: 1 },
    { name: "Personal", count: 1 },
    { name: "Work", count: 2 }
  ]);
});

test("profile usage ignores malformed workspace collections", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.summarizeProfileUsage(null))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.summarizeProfileUsage([{}, { nodes: "invalid" }]))), []);
});

test("browser profile names are trimmed, bounded and restricted to a safe ASCII subset", () => {
  assert.equal(bridge.normalizeProfileName("  Work  "), "Work");
  assert.equal(bridge.normalizeProfileName("Research_2"), "Research_2");
  assert.equal(bridge.normalizeProfileName("two  "), "two");
  assert.equal(bridge.normalizeProfileName("A".repeat(64)), "A".repeat(64));
  for (const value of ["", "bad/name", "trailing.", "ümlaut", "x".repeat(65), null]) {
    assert.equal(bridge.normalizeProfileName(value), null);
  }
});

test("native surface state reports private mode only when the host sends a boolean", () => {
  const privateState = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "private-1", state: "ready", isPrivateMode: true
  });
  assert.equal(privateState.isPrivateMode, true);
  const regularState = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "regular-1", state: "ready", isPrivateMode: false
  });
  assert.equal(regularState.isPrivateMode, false);
  const invalidState = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "legacy-1", state: "ready", isPrivateMode: "true"
  });
  assert.equal(invalidState.isPrivateMode, null);
  const namedProfile = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "profile-1", state: "ready", profileName: "Work"
  });
  assert.equal(namedProfile.profileName, "Work");
  const invalidProfile = bridge.normalizeSurfaceState({
    type: "nolane.native.surface", id: "profile-2", state: "ready", profileName: "bad/name"
  });
  assert.equal(invalidProfile.profileName, null);
});

test("viewport metadata is bounded and normalized for the Windows overlay", () => {
  const viewport = bridge.normalizeViewport({ screenLeft: 10, screenTop: 50, width: 1440, height: 900, deviceScale: 1.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(viewport)), { screenLeft: 10, screenTop: 50, width: 1440, height: 900, deviceScale: 1.5 });
  assert.equal(bridge.normalizeViewport({ screenLeft: 0, screenTop: 0, width: 20, height: 900, deviceScale: 1 }), null);
  assert.equal(bridge.normalizeViewport({ screenLeft: "NaN", screenTop: 0, width: 1440, height: 900, deviceScale: 1 }), null);
});
