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
    type: "nolane.surface.command", protocol: 1, id: "node-1", action: "back"
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
