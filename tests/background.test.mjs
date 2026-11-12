import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const backgroundSource = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    fire(...args) { for (const listener of listeners) listener(...args); }
  };
}

function createHarness() {
  const localStore = {};
  const sessionStore = {};
  const debugCalls = [];
  const sentMessages = [];
  const streamRequests = [];
  const detachedTabs = [];
  const runtimeMessage = makeEvent();
  const debuggerEvent = makeEvent();
  const debuggerDetached = makeEvent();
  const tabRemoved = makeEvent();
  const captureStatus = makeEvent();

  const tabs = new Map([
    [10, {
      id: 10,
      windowId: 1,
      active: true,
      url: "https://youpass.vn/dashboard",
      title: "YouPass dashboard",
      width: 1365,
      height: 768
    }],
    [20, {
      id: 20,
      windowId: 1,
      active: false,
      url: "https://nolane-x.github.io/web-view/",
      title: "Nolane Infinite"
    }]
  ]);

  const chrome = {
    runtime: {
      onMessage: runtimeMessage,
      getURL(path) { return "chrome-extension://nolane-test/" + path; }
    },
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, localStore[key]]));
        },
        async set(values) { Object.assign(localStore, values); }
      },
      session: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, sessionStore[key]]));
        },
        async set(values) { Object.assign(sessionStore, values); },
        async remove(keys) {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete sessionStore[key];
        }
      }
    },
    tabs: {
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error("No tab with id: " + tabId);
        return { ...tab };
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
        if (message.type === "NOLANE_LIVE_SURFACE_START") {
          queueMicrotask(() => {
            const listener = runtimeMessage.listeners[0];
            listener({
              type: "NOLANE_LIVE_SURFACE_ACK",
              surfaceId: message.surfaceId,
              browserSessionId: message.browserSessionId
            }, {
              tab: { id: tabId },
              url: "https://nolane-x.github.io/web-view/"
            }, () => {});
          });
        }
        return { ok: true };
      },
      async update(tabId, changes) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error("No tab with id: " + tabId);
        Object.assign(tab, changes);
        return { ...tab };
      },
      onRemoved: tabRemoved
    },
    windows: {
      async update() { return {}; }
    },
    debugger: {
      onEvent: debuggerEvent,
      onDetach: debuggerDetached,
      async attach(target, version) { debugCalls.push({ method: "attach", target, version }); },
      async sendCommand(target, method, params) {
        debugCalls.push({ method, target, params });
        if (method === "Page.getLayoutMetrics") {
          return {
            cssVisualViewport: { clientWidth: 1365, clientHeight: 768 },
            cssLayoutViewport: { clientWidth: 1365, clientHeight: 768 }
          };
        }
        return {};
      },
      async detach(target) { detachedTabs.push(target.tabId); }
    },
    tabCapture: {
      onStatusChanged: captureStatus,
      async getMediaStreamId(options) {
        streamRequests.push(options);
        return "one-use-tab-stream-token";
      }
    }
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    URL,
    crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789012" },
    console
  }, { filename: "extension/background.js" });

  async function send(message, sender = {}) {
    const listener = runtimeMessage.listeners[0];
    assert.ok(listener, "background message listener was registered");
    return await new Promise((resolve, reject) => {
      let settled = false;
      const sendResponse = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const keepAlive = listener(message, sender, sendResponse);
        if (keepAlive !== true && !settled) resolve(undefined);
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    send,
    tabs,
    debugCalls,
    sentMessages,
    streamRequests,
    detachedTabs,
    sessionStore,
    localStore
  };
}

test("live capture is tied to the active source tab and the exact Nolane consumer tab", async () => {
  const h = createHarness();
  const registered = await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  assert.equal(registered.ok, true);
  assert.equal(typeof registered.profileId, "string");

  const started = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );

  assert.equal(started.ok, true);
  assert.equal(started.title, "YouPass dashboard");
  assert.equal(h.streamRequests.length, 1);
  assert.equal(
    JSON.stringify(h.streamRequests[0]),
    JSON.stringify({ targetTabId: 10, consumerTabId: 20 })
  );
  assert.ok(h.debugCalls.some((call) => call.method === "attach" && call.target.tabId === 10));
  assert.ok(h.debugCalls.some((call) => call.method === "Page.enable"));
  assert.ok(h.debugCalls.some((call) => call.method === "Page.getLayoutMetrics"));

  const startMessage = h.sentMessages.find((item) => item.message.type === "NOLANE_LIVE_SURFACE_START");
  assert.ok(startMessage);
  assert.equal(startMessage.tabId, 20);
  assert.equal(startMessage.message.surfaceId, started.surfaceId);
  assert.equal(startMessage.message.browserSessionId, registered.profileId);
  assert.equal(startMessage.message.streamId, "one-use-tab-stream-token");
});

test("mouse and keyboard input are forwarded only from the registered workspace and source origin", async () => {
  const h = createHarness();
  const registered = await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  const started = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );

  const sender = { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" };
  const mouse = await h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: registered.profileId,
    kind: "mousePressed",
    x: 120,
    y: 80,
    button: "left",
    buttons: 1,
    clickCount: 1
  }, sender);
  assert.equal(mouse.ok, true);
  assert.ok(h.debugCalls.some((call) =>
    call.method === "Input.dispatchMouseEvent" &&
    call.params.type === "mousePressed" &&
    call.params.x === 120 &&
    call.params.y === 80
  ));

  const keyboard = await h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: registered.profileId,
    kind: "keyDown",
    key: "a",
    code: "KeyA",
    keyCode: 65,
    text: "a",
    unmodifiedText: "a"
  }, sender);
  assert.equal(keyboard.ok, true);
  assert.ok(h.debugCalls.some((call) =>
    call.method === "Input.dispatchKeyEvent" &&
    call.params.type === "keyDown" &&
    call.params.key === "a"
  ));

  const wrongSender = await h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: registered.profileId,
    kind: "mousePressed",
    x: 10,
    y: 10,
    button: "left"
  }, { tab: { id: 99 }, url: "https://attacker.example/" });
  assert.equal(wrongSender.ok, false);
  assert.match(wrongSender.error, /no longer connected to this browser profile/i);
});

test("live input is rejected and the debugger is detached when the source changes origin", async () => {
  const h = createHarness();
  const registered = await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  const started = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );

  h.tabs.set(10, { ...h.tabs.get(10), url: "https://attacker.example/changed" });
  const result = await h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: registered.profileId,
    kind: "mouseMoved",
    x: 20,
    y: 20
  }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });

  assert.equal(result.ok, false);
  assert.match(result.error, /source website changed/i);
  assert.ok(h.detachedTabs.includes(10));
  assert.ok(h.sentMessages.some((item) =>
    item.tabId === 20 &&
    item.message.type === "NOLANE_LIVE_SURFACE_STOPPED" &&
    item.message.surfaceId === started.surfaceId
  ));
});

test("capture cannot start from an arbitrary webpage or for an inactive tab", async () => {
  const h = createHarness();
  await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );

  const wrongSender = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "https://youpass.vn/" }
  );
  assert.equal(wrongSender.ok, false);
  assert.match(wrongSender.error, /Companion popup/i);

  h.tabs.set(10, { ...h.tabs.get(10), active: false });
  const inactive = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  assert.equal(inactive.ok, false);
  assert.match(inactive.error, /no longer the active tab/i);
  assert.equal(h.streamRequests.length, 0);
});
