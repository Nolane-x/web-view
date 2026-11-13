import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(fs.readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const contentSource = fs.readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const WORKSPACE_ORIGIN = "https://nolane-x.github.io";

function createBridgeHarness(runtimeResult = { ok: true }) {
  const runtimeListeners = [];
  const windowListeners = new Map();
  const posted = [];
  const sent = [];
  const windowObject = {
    postMessage(data, targetOrigin) { posted.push({ data, targetOrigin }); },
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || [];
      list.push(listener);
      windowListeners.set(type, list);
    },
    dispatchMessage(data, origin = WORKSPACE_ORIGIN, source = windowObject) {
      for (const listener of windowListeners.get("message") || []) listener({ source, origin, data });
    }
  };
  const chrome = {
    runtime: {
      id: "nolane-test-extension",
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      sendMessage(message) {
        sent.push(message);
        if (message.type === "NOLANE_REGISTER_WORKSPACE") return Promise.resolve({ ok: true, profileId: "profile-123" });
        return Promise.resolve(runtimeResult);
      }
    }
  };
  vm.runInNewContext(contentSource, {
    chrome,
    window: windowObject,
    location: { href: WORKSPACE_ORIGIN + "/web-view/", origin: WORKSPACE_ORIGIN },
    Date,
    String,
    Number,
    Promise,
    console
  }, { filename: "extension/content.js" });
  return { chrome, windowObject, runtimeListeners, posted, sent };
}

test("content-script ping returns exactly the installed manifest version", () => {
  const h = createBridgeHarness();
  const listener = h.runtimeListeners[0];
  let response;
  listener({ type: "NOLANE_WORKSPACE_PING" }, { id: "nolane-test-extension" }, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(response.version, manifest.version);
  assert.equal(response.url, "https://nolane-x.github.io/web-view/");
});

test("live input is forwarded to the service worker and its success is acknowledged on the page", async () => {
  const h = createBridgeHarness({ ok: true });
  h.windowObject.dispatchMessage({
    source: "nolane-workspace",
    type: "LIVE_INPUT",
    surfaceId: "surface-1",
    browserSessionId: "profile-123",
    kind: "mousePressed",
    x: 80,
    y: 42,
    button: "left"
  });
  await Promise.resolve();
  await Promise.resolve();
  const forwarded = h.sent.find((message) => message.type === "NOLANE_LIVE_INPUT");
  assert.ok(forwarded);
  assert.equal(forwarded.surfaceId, "surface-1");
  assert.equal(forwarded.kind, "mousePressed");
  assert.equal(forwarded.x, 80);
  assert.equal(forwarded.y, 42);
  const result = h.posted.find((entry) => entry.data.type === "LIVE_INPUT_RESULT");
  assert.ok(result);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.surfaceId, "surface-1");
});

test("live input failures are sent back to Nolane instead of silently disappearing", async () => {
  const h = createBridgeHarness({ ok: false, error: "Debugger session is not interactive." });
  h.windowObject.dispatchMessage({
    source: "nolane-workspace",
    type: "LIVE_INPUT",
    surfaceId: "surface-2",
    browserSessionId: "profile-123",
    kind: "mousePressed",
    x: 10,
    y: 12
  });
  await Promise.resolve();
  await Promise.resolve();
  const result = h.posted.find((entry) => entry.data.type === "LIVE_INPUT_RESULT");
  assert.ok(result);
  assert.equal(result.data.ok, false);
  assert.match(result.data.error, /not interactive/i);
});

test("content script ignores page messages from other origins and non-window sources", async () => {
  const h = createBridgeHarness({ ok: true });
  const foreignWindow = {};
  h.windowObject.dispatchMessage({
    source: "nolane-workspace", type: "LIVE_INPUT", surfaceId: "bad",
    browserSessionId: "profile-123", kind: "mousePressed", x: 1, y: 1
  }, "https://attacker.example");
  h.windowObject.dispatchMessage({
    source: "nolane-workspace", type: "LIVE_INPUT", surfaceId: "bad",
    browserSessionId: "profile-123", kind: "mousePressed", x: 1, y: 1
  }, WORKSPACE_ORIGIN, foreignWindow);
  await Promise.resolve();
  assert.equal(h.sent.some((message) => message.type === "NOLANE_LIVE_INPUT"), false);
});
