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

function createHarness(options = {}) {
  const localStore = {};
  const sessionStore = {};
  const debugCalls = [];
  const sentMessages = [];
  const streamRequests = [];
  const detachedTabs = [];
  const tabUpdates = [];
  const windowUpdates = [];
  const eventOrder = [];
  let uuidCounter = 0;
  const runtimeMessage = makeEvent();
  const debuggerEvent = makeEvent();
  const debuggerDetached = makeEvent();
  const tabRemoved = makeEvent();
  const tabUpdated = makeEvent();
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
        eventOrder.push("sendMessage:" + message.type);
        sentMessages.push({ tabId, message });
        if (message.type === "NOLANE_LIVE_SURFACE_START") {
          if (typeof options.beforeAck === "function") await options.beforeAck(tabId, message);
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
        eventOrder.push("tabs.update:" + tabId);
        tabUpdates.push({ tabId, changes });
        const tab = tabs.get(tabId);
        if (!tab) throw new Error("No tab with id: " + tabId);
        Object.assign(tab, changes);
        return { ...tab };
      },
      onRemoved: tabRemoved,
      onUpdated: tabUpdated
    },
    windows: {
      async update(windowId, changes) { eventOrder.push("windows.update:" + windowId); windowUpdates.push({ windowId, changes }); return {}; }
    },
    debugger: {
      onEvent: debuggerEvent,
      onDetach: debuggerDetached,
      async attach(target, version) {
        debugCalls.push({ method: "attach", target, version });
        if (options.attachError) throw new Error(options.attachError);
      },
      async sendCommand(target, method, params) {
        debugCalls.push({ method, target, params });
        if (typeof options.beforeDebugCommand === "function") {
          await options.beforeDebugCommand(target, method, params);
        }
        if (options.commandErrors?.includes(method)) throw new Error("Simulated " + method + " failure");
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
        eventOrder.push("getMediaStreamId");
        streamRequests.push(options);
        return "one-use-tab-stream-token";
      }
    }
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    URL,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "12345678-1234-1234-1234-" + String(++uuidCounter).padStart(12, "0") },
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
    tabUpdates,
    windowUpdates,
    sessionStore,
    localStore,
    tabRemoved,
    tabUpdated,
    eventOrder
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
  assert.equal(started.interactive, true);
  assert.equal(started.title, "YouPass dashboard");
  assert.ok(h.tabUpdates.some((update) => update.tabId === 20 && update.changes.active === true));
  assert.ok(h.windowUpdates.some((update) => update.windowId === 1 && update.changes.focused === true));
  assert.equal(h.streamRequests.length, 1);
  assert.ok(h.eventOrder.indexOf("windows.update:1") < h.eventOrder.indexOf("getMediaStreamId"), "focus the consumer tab before minting the short-lived stream ID");
  assert.ok(h.eventOrder.indexOf("getMediaStreamId") < h.eventOrder.indexOf("sendMessage:NOLANE_LIVE_SURFACE_START"), "deliver the token immediately after it is created");
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

test("starting a second live surface for the same Chrome tab is rejected", async () => {
  const h = createHarness();
  await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  const first = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  assert.equal(first.ok, true);

  const second = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  assert.equal(second.ok, false);
  assert.match(second.error, /already streaming/i);
  assert.equal(h.streamRequests.length, 1);
});

test("workspace enforces the concurrent live-surface limit", async () => {
  const h = createHarness();
  await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );

  for (const id of [10, 11, 12]) {
    const current = h.tabs.get(id) || {
      id,
      windowId: 1,
      active: true,
      url: "https://site-" + id + ".example/",
      title: "Site " + id,
      width: 1280,
      height: 720
    };
    h.tabs.set(id, { ...current, active: true });
    const result = await h.send(
      { type: "NOLANE_START_LIVE_SURFACE", tabId: id },
      { url: "chrome-extension://nolane-test/popup.html" }
    );
    assert.equal(result.ok, true);
  }

  assert.equal(Object.keys(h.sessionStore.nolaneLiveSessions || {}).length, 3, "three acknowledged live sessions should be stored");

  h.tabs.set(13, {
    id: 13,
    windowId: 1,
    active: true,
    url: "https://site-13.example/",
    title: "Site 13",
    width: 1280,
    height: 720
  });
  const fourth = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 13 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  assert.equal(fourth.ok, false);
  assert.match(fourth.error, /3 live Chrome surfaces/i);
  assert.equal(h.streamRequests.length, 3);
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

  const sameTabWrongOrigin = await h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: registered.profileId,
    kind: "mousePressed",
    x: 10,
    y: 10,
    button: "left"
  }, { tab: { id: 20 }, url: "https://attacker.example/" });
  assert.equal(sameTabWrongOrigin.ok, false);
  assert.match(sameTabWrongOrigin.error, /no longer connected to this browser profile/i);
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


test("live input queue serializes events and coalesces pointer movement without crossing clicks", async () => {
  let releaseFirstMove;
  let signalFirstMove;
  let blocked = false;
  const firstMoveStarted = new Promise((resolve) => { signalFirstMove = resolve; });
  const h = createHarness({
    beforeDebugCommand: async (_target, method, params) => {
      if (!blocked && method === "Input.dispatchMouseEvent" && params.type === "mouseMoved") {
        blocked = true;
        signalFirstMove();
        await new Promise((resolve) => { releaseFirstMove = resolve; });
      }
    }
  });
  const registered = await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  const started = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  const sender = { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" };
  const sendMouse = (kind, x) => h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: registered.profileId,
    kind,
    x,
    y: 40,
    button: "left",
    buttons: kind === "mousePressed" ? 1 : 0
  }, sender);

  const first = sendMouse("mouseMoved", 10);
  await firstMoveStarted;
  const second = sendMouse("mouseMoved", 20);
  const third = sendMouse("mouseMoved", 30);
  const click = sendMouse("mousePressed", 40);
  const fourth = sendMouse("mouseMoved", 50);
  releaseFirstMove();
  const results = await Promise.all([first, second, third, click, fourth]);
  assert.ok(results.every((result) => result.ok));

  const dispatched = h.debugCalls
    .filter((call) => call.method === "Input.dispatchMouseEvent")
    .map((call) => [call.params.type, call.params.x]);
  assert.deepEqual(dispatched, [
    ["mouseMoved", 10],
    ["mouseMoved", 30],
    ["mousePressed", 40],
    ["mouseMoved", 50]
  ]);
});

test("reloading the Nolane workspace releases source debugger sessions", async () => {
  const h = createHarness();
  await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  const started = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  assert.equal(started.ok, true);
  h.tabUpdated.fire(20, { status: "loading" }, { id: 20 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(Object.keys(h.sessionStore.nolaneLiveSessions || {}).length, 0);
  assert.ok(h.detachedTabs.includes(10));
});

test("closing the Nolane workspace releases its source debugger sessions", async () => {
  const h = createHarness();
  await h.send(
    { type: "NOLANE_REGISTER_WORKSPACE" },
    { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" }
  );
  const started = await h.send(
    { type: "NOLANE_START_LIVE_SURFACE", tabId: 10 },
    { url: "chrome-extension://nolane-test/popup.html" }
  );
  assert.equal(started.ok, true);
  h.tabRemoved.fire(20, { windowId: 1, isWindowClosing: false });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(Object.keys(h.sessionStore.nolaneLiveSessions || {}).length, 0);
  assert.ok(h.detachedTabs.includes(10));
});


test("foreign extension debugger restriction falls back to an available video-only surface", async () => {
  const h = createHarness({ attachError: "Cannot access a chrome-extension:// URL of different extension" });
  await h.send({ type: "NOLANE_REGISTER_WORKSPACE" }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });
  const started = await h.send({ type: "NOLANE_START_LIVE_SURFACE", tabId: 10 }, { url: "chrome-extension://nolane-test/popup.html" });
  assert.equal(started.ok, true);
  assert.equal(started.interactive, false);
  assert.match(started.interactionReason, /frame or content injected by another extension/i);
  assert.equal(h.streamRequests.length, 1);
  assert.equal(h.sentMessages.some((item) => item.message.type === "NOLANE_LIVE_SURFACE_START"), true);
  const session = Object.values(h.sessionStore.nolaneLiveSessions)[0];
  assert.equal(session.debuggerAttached, false);
  assert.equal(session.interactive, false);
  const input = await h.send({
    type: "NOLANE_LIVE_INPUT",
    surfaceId: started.surfaceId,
    browserSessionId: session.profileId,
    kind: "mousePressed",
    x: 25,
    y: 25,
    button: "left"
  }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });
  assert.equal(input.ok, false);
  assert.match(input.error, /frame or content injected by another extension/i);
  assert.equal(h.debugCalls.some((call) => call.method === "Input.dispatchMouseEvent"), false);
});

test("CDP viewport error releases partial debugger and still captures source tab video", async () => {
  const h = createHarness({ commandErrors: ["Page.getLayoutMetrics"] });
  await h.send({ type: "NOLANE_REGISTER_WORKSPACE" }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });
  const started = await h.send({ type: "NOLANE_START_LIVE_SURFACE", tabId: 10 }, { url: "chrome-extension://nolane-test/popup.html" });
  assert.equal(started.ok, true);
  assert.equal(started.interactive, false);
  assert.equal(h.streamRequests.length, 1);
  assert.ok(h.detachedTabs.includes(10), "partial debugger attachment must be released");
  assert.equal(Object.values(h.sessionStore.nolaneLiveSessions)[0].debuggerAttached, false);
});


test("cross-origin navigation stops a video-only stream without debugger events", async () => {
  const h = createHarness({ attachError: "Cannot access a chrome-extension:// URL of different extension" });
  await h.send({ type: "NOLANE_REGISTER_WORKSPACE" }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });
  const started = await h.send({ type: "NOLANE_START_LIVE_SURFACE", tabId: 10 }, { url: "chrome-extension://nolane-test/popup.html" });
  assert.equal(started.ok, true);
  assert.equal(started.interactive, false);

  h.tabUpdated.fire(10, { url: "https://youpass.vn/practice/reading" }, { id: 10, url: "https://youpass.vn/practice/reading" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(Object.keys(h.sessionStore.nolaneLiveSessions || {}).length, 1, "same-origin navigation should keep the approved session");

  h.tabUpdated.fire(10, { url: "https://example.org/redirected" }, { id: 10, url: "https://example.org/redirected" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(Object.keys(h.sessionStore.nolaneLiveSessions || {}).length, 0);
  assert.ok(h.sentMessages.some((item) =>
    item.tabId === 20 &&
    item.message.type === "NOLANE_LIVE_SURFACE_STOPPED" &&
    item.message.surfaceId === started.surfaceId &&
    /different website/.test(item.message.reason)
  ));
});

test("legacy live sessions without debuggerAttached still release their previous CDP attachment", async () => {
  const h = createHarness();
  await h.send({ type: "NOLANE_REGISTER_WORKSPACE" }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });
  const started = await h.send({ type: "NOLANE_START_LIVE_SURFACE", tabId: 10 }, { url: "chrome-extension://nolane-test/popup.html" });
  delete h.sessionStore.nolaneLiveSessions[started.surfaceId].debuggerAttached;
  h.tabUpdated.fire(20, { status: "loading" }, { id: 20 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(h.detachedTabs.includes(10));
});


test("cross-origin navigation during startup rejects the pending ACK and releases the source debugger", async () => {
  let h;
  h = createHarness({
    beforeAck: async () => {
      h.tabUpdated.fire(10, { url: "https://attacker.example/changed" }, { id: 10, url: "https://attacker.example/changed" });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
  await h.send({ type: "NOLANE_REGISTER_WORKSPACE" }, { tab: { id: 20 }, url: "https://nolane-x.github.io/web-view/" });
  const result = await h.send({ type: "NOLANE_START_LIVE_SURFACE", tabId: 10 }, { url: "chrome-extension://nolane-test/popup.html" });
  assert.equal(result.ok, false);
  assert.match(result.error, /different website|source tab navigated/i);
  assert.equal(Object.keys(h.sessionStore.nolaneLiveSessions || {}).length, 0);
  assert.ok(h.detachedTabs.includes(10));
});
