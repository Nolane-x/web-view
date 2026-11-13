"use strict";

const WORKSPACE_ORIGIN = "https://nolane-x.github.io";
const WORKSPACE_URL_PREFIX = WORKSPACE_ORIGIN + "/web-view/";
const PROFILE_KEY = "nolaneProfileId";
const LAST_DIAGNOSTIC_KEY = "nolaneLastLiveDiagnostic";
const WORKSPACE_KEY = "nolaneWorkspaceTab";
const LIVE_SESSIONS_KEY = "nolaneLiveSessions";
const LIVE_START_TIMEOUT_MS = 12000;
const MAX_LIVE_SURFACES_PER_WORKSPACE = 3;
const pendingLiveStarts = new Map();
const pendingViewportRefreshes = new Map();
const liveInputQueues = new Map();
const stoppedLiveSurfaceIds = new Set();
const MAX_LIVE_INPUT_QUEUE = 96;

const profileIdPromise = chrome.storage.local.get([PROFILE_KEY]).then(async (stored) => {
  if (typeof stored[PROFILE_KEY] === "string" && stored[PROFILE_KEY].length > 20) return stored[PROFILE_KEY];
  const profileId = crypto.randomUUID();
  await chrome.storage.local.set({ [PROFILE_KEY]: profileId });
  return profileId;
});

async function getWorkspaceTabId() {
  const stored = await chrome.storage.session.get(WORKSPACE_KEY);
  const tabId = stored[WORKSPACE_KEY]?.tabId;
  if (!Number.isInteger(tabId)) throw new Error("Open Nolane Infinite in another Chrome tab first, then refresh it.");
  const tab = await chrome.tabs.get(tabId);
  if (typeof tab.url !== "string" || !tab.url.startsWith(WORKSPACE_URL_PREFIX)) {
    await chrome.storage.session.remove(WORKSPACE_KEY);
    throw new Error("The Nolane workspace tab is no longer available. Refresh Nolane and try again.");
  }
  return tabId;
}

async function getLiveSessions() {
  const stored = await chrome.storage.session.get(LIVE_SESSIONS_KEY);
  return stored[LIVE_SESSIONS_KEY] && typeof stored[LIVE_SESSIONS_KEY] === "object"
    ? stored[LIVE_SESSIONS_KEY]
    : {};
}

async function saveLiveSessions(sessions) {
  await chrome.storage.session.set({ [LIVE_SESSIONS_KEY]: sessions });
}

function isWorkspaceSender(sender) {
  return Number.isInteger(sender?.tab?.id) &&
    typeof sender.url === "string" &&
    sender.url.startsWith(WORKSPACE_URL_PREFIX);
}

function pageOrigin(value) {
  try { return new URL(value).origin; } catch (_) { return ""; }
}

function normalizeVideoInfo(value) {
  if (!value || typeof value !== "object") return null;
  const number = (key, max = 100000) => Number.isFinite(value[key])
    ? Math.max(0, Math.min(max, Number(value[key])))
    : null;
  return {
    width: number("width", 16384),
    height: number("height", 16384),
    frameRate: number("frameRate", 240),
    presentedFrames: number("presentedFrames", 1000000000),
    mediaTime: number("mediaTime", 86400000),
    droppedFrames: number("droppedFrames", 1000000000),
    totalVideoFrames: number("totalVideoFrames", 1000000000),
    trackReadyState: value.trackReadyState === "live" || value.trackReadyState === "ended" ? value.trackReadyState : "unknown",
    trackMuted: !!value.trackMuted
  };
}

function normalizeHealthState(value) {
  return ["checking", "healthy", "stalled", "muted", "paused", "ended"].includes(value) ? value : "checking";
}

function cleanShareUrl(raw) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|password|passwd|credential|authorization|auth|access.?key|api.?key|signature|^sig$|^jwt$|^code$|id.?token|refresh.?token|session.?id|^nonce$|^state$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.href;
  } catch (_) {
    return "";
  }
}

async function sendToWorkspace(session, message) {
  try { await chrome.tabs.sendMessage(session.workspaceTabId, message); } catch (_) {}
}

async function removeLiveSession(surfaceId, reason, notifyWorkspace = true, detachDebugger = true) {
  const sessions = await getLiveSessions();
  const session = sessions[surfaceId];
  if (!session) return false;
  delete sessions[surfaceId];
  stoppedLiveSurfaceIds.add(surfaceId);
  if (stoppedLiveSurfaceIds.size > 256) stoppedLiveSurfaceIds.delete(stoppedLiveSurfaceIds.values().next().value);
  const pendingStart = pendingLiveStarts.get(surfaceId);
  if (pendingStart) pendingStart.reject(new Error(reason || "The live surface stopped before it connected."));
  clearLiveInputQueue(surfaceId, reason || "The live surface stopped.");
  await saveLiveSessions(sessions);
  const viewportTimer = pendingViewportRefreshes.get(session.sourceTabId);
  if (viewportTimer) clearTimeout(viewportTimer);
  pendingViewportRefreshes.delete(session.sourceTabId);
  // Legacy sessions predate debuggerAttached; default them to true so an
  // extension update cannot strand an old CDP attachment.
  if (detachDebugger && session.debuggerAttached !== false) {
    try { await chrome.debugger.detach({ tabId: session.sourceTabId }); } catch (_) {}
  }
  if (notifyWorkspace) {
    await sendToWorkspace(session, {
      type: "NOLANE_LIVE_SURFACE_STOPPED",
      surfaceId,
      reason: reason || "The live Chrome surface stopped."
    });
  }
  return true;
}

async function removeSessionsForTab(tabId, reason, detachDebugger = true) {
  const sessions = await getLiveSessions();
  const matches = Object.values(sessions).filter((session) => session.sourceTabId === tabId);
  for (const session of matches) {
    await removeLiveSession(session.surfaceId, reason, true, detachDebugger);
  }
}

async function removeSessionsForWorkspaceTab(tabId, reason) {
  const sessions = await getLiveSessions();
  const matches = Object.values(sessions).filter((session) => session.workspaceTabId === tabId);
  for (const session of matches) {
    await removeLiveSession(session.surfaceId, reason || "The Nolane workspace was closed or reloaded.", false, true);
  }
}

async function startLiveSurface(message, sender) {
  const popupUrl = chrome.runtime.getURL("popup.html");
  if (!sender.url || !sender.url.startsWith(popupUrl)) {
    throw new Error("Live capture can only be started from the Nolane Companion popup.");
  }
  if (!Number.isInteger(message.tabId)) throw new Error("Could not identify the active Chrome tab.");

  const workspaceTabId = await getWorkspaceTabId();
  const profileId = await profileIdPromise;
  const activeSessions = Object.values(await getLiveSessions()).filter((session) => session.workspaceTabId === workspaceTabId);
  if (activeSessions.some((session) => session.sourceTabId === message.tabId)) {
    throw new Error("This Chrome tab is already streaming to Nolane. Stop its existing live surface first.");
  }
  if (activeSessions.length >= MAX_LIVE_SURFACES_PER_WORKSPACE) {
    throw new Error("This workspace already has " + MAX_LIVE_SURFACES_PER_WORKSPACE + " live Chrome surfaces. Stop one before starting another.");
  }
  if (message.tabId === workspaceTabId) {
    throw new Error("Switch to the website you want to show, then open the Companion on that tab.");
  }

  const tab = await chrome.tabs.get(message.tabId);
  if (!tab.active) throw new Error("The source page is no longer the active tab. Reopen the Companion on that page.");
  const keepSourceVisible = message.keepSourceVisible !== false;
  if (typeof chrome.tabCapture.getCapturedTabs === "function") {
    const capturedTabs = await chrome.tabCapture.getCapturedTabs();
    const alreadyCaptured = (capturedTabs || []).find((item) => item.tabId === tab.id && ["pending", "active"].includes(item.status));
    if (alreadyCaptured) {
      throw new Error("Chrome already reports an active capture for this tab. Stop the previous capture in Nolane or another recorder before starting a new one.");
    }
  }
  const safeUrl = cleanShareUrl(tab.url || "");
  const expectedOrigin = pageOrigin(tab.url || "");
  if (!safeUrl || !expectedOrigin) {
    throw new Error("Chrome can stream only a normal http:// or https:// website tab. Extension, settings and browser pages are not supported.");
  }

  const surfaceId = crypto.randomUUID();
  const debuggee = { tabId: tab.id };
  let debuggerAttached = false;
  let interactive = false;
  let interactionReason = "";
  let acknowledgement = null;
  let sourceKeptVisible = false;
  let workspaceWindowId = null;
  let stage = "checking the browser tab";
  let viewport = {
    width: Math.max(1, Math.round(tab.width || 1280)),
    height: Math.max(1, Math.round(tab.height || 720))
  };

  try {
    // CDP is optional: Chromium may reject a tab containing another extension's
    // chrome-extension:// iframe. Preserve the independent tabCapture video path.
    try {
      stage = "attaching Chrome's optional input controller";
      await chrome.debugger.attach(debuggee, "1.3");
      debuggerAttached = true;
      stage = "reading the Chrome page viewport";
      await chrome.debugger.sendCommand(debuggee, "Page.enable");
      const metrics = await chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics");
      const visual = metrics.cssVisualViewport || {};
      const layout = metrics.cssLayoutViewport || {};
      viewport = {
        width: Math.max(1, Math.round(visual.clientWidth || layout.clientWidth || tab.width || 1280)),
        height: Math.max(1, Math.round(visual.clientHeight || layout.clientHeight || tab.height || 720))
      };
      interactive = true;
    } catch (debugError) {
      const raw = String(debugError?.message || debugError);
      const foreignExtensionFrame = /Cannot access a chrome-extension:\/\/ URL of different extension/i.test(raw);
      interactionReason = foreignExtensionFrame
        ? "Chrome blocked its debugger because this page contains a frame or content injected by another extension. The real page video can still be shown. Use Focus source to interact, or try a clean Chrome profile / disable extensions that inject page UI."
        : "Chrome's debugger could not attach (" + raw.slice(0, 180) + "). The real page video can still be shown. Use Focus source to interact, or close DevTools and other page-debugging tools before reconnecting.";
      if (debuggerAttached) {
        try { await chrome.debugger.detach(debuggee); } catch (_) {}
        debuggerAttached = false;
      }
      interactive = false;
    }

    const session = {
      surfaceId,
      sourceTabId: tab.id,
      workspaceTabId,
      profileId,
      expectedOrigin,
      viewport,
      sourceTitle: String(tab.title || new URL(safeUrl).hostname).slice(0, 120),
      sourceUrl: safeUrl,
      createdAt: Date.now(),
      acknowledged: false,
      captureStatus: "requested",
      captureStatusAt: Date.now(),
      healthState: "checking",
      lastHealthAt: 0,
      debuggerAttached,
      interactive,
      interactionReason,
      keepSourceVisible: false,
      workspaceWindowId: null
    };
    const sessions = await getLiveSessions();
    sessions[surfaceId] = session;
    await saveLiveSessions(sessions);

    stage = "preparing the Nolane canvas window";
    let workspaceTab = await chrome.tabs.get(workspaceTabId);
    if (keepSourceVisible) {
      if (workspaceTab.windowId !== tab.windowId) {
        // The two tabs already live in separate windows; foreground Nolane
        // without changing which website tab is selected in the source window.
        await chrome.windows.update(workspaceTab.windowId, { focused: true });
        sourceKeptVisible = true;
        workspaceWindowId = workspaceTab.windowId;
      } else {
        // Move the existing Nolane tab, preserving its document/content script,
        // into a separate window. The source tab remains selected in its own
        // non-minimized window, so visibility-aware websites can keep rendering.
        try {
          const sourceWindow = await chrome.windows.get(tab.windowId);
          const createData = {
            tabId: workspaceTabId,
            type: "normal",
            focused: true
          };
          if (sourceWindow.state === "normal" && Number.isFinite(sourceWindow.left) &&
              Number.isFinite(sourceWindow.top) && Number.isFinite(sourceWindow.width) &&
              Number.isFinite(sourceWindow.height) && sourceWindow.width >= 1120) {
            const workspaceWidth = Math.max(560, Math.floor(sourceWindow.width * 0.52));
            createData.left = sourceWindow.left + sourceWindow.width - workspaceWidth;
            createData.top = sourceWindow.top;
            createData.width = workspaceWidth;
            createData.height = sourceWindow.height;
          }
          const separateWindow = await chrome.windows.create(createData);
          if (Number.isInteger(separateWindow?.id)) {
            sourceKeptVisible = true;
            workspaceWindowId = separateWindow.id;
          }
        } catch (_) {
          sourceKeptVisible = false;
        }
      }
    }
    if (!sourceKeptVisible) {
      workspaceTab = await chrome.tabs.get(workspaceTabId);
      await chrome.tabs.update(workspaceTabId, { active: true });
      await chrome.windows.update(workspaceTab.windowId, { focused: true });
      workspaceWindowId = workspaceTab.windowId;
    }
    workspaceTab = await chrome.tabs.get(workspaceTabId);
    session.keepSourceVisible = sourceKeptVisible;
    session.workspaceWindowId = workspaceWindowId;
    const updatedSessions = await getLiveSessions();
    if (updatedSessions[surfaceId]) {
      updatedSessions[surfaceId].keepSourceVisible = sourceKeptVisible;
      updatedSessions[surfaceId].workspaceWindowId = workspaceWindowId;
      await saveLiveSessions(updatedSessions);
    }

    // Mint the one-use stream ID only after the consumer tab is visible. It
    // expires quickly, so do not await storage/focus work after creating it.
    stage = "creating the tab-capture stream";
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
      consumerTabId: workspaceTabId
    });
    if (stoppedLiveSurfaceIds.has(surfaceId)) {
      stoppedLiveSurfaceIds.delete(surfaceId);
      throw new Error("The source tab navigated to a different website before capture started.");
    }

    // The acknowledgement timeout starts only after a stream token exists. This
    // avoids an unobserved rejected Promise if tabCapture itself fails.
    acknowledgement = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingLiveStarts.delete(surfaceId);
        reject(new Error("Nolane did not confirm a decoded video frame. Keep the workspace tab open and try again."));
      }, LIVE_START_TIMEOUT_MS);
      pendingLiveStarts.set(surfaceId, {
        resolve: () => { clearTimeout(timeoutId); pendingLiveStarts.delete(surfaceId); resolve(); },
        reject: (reason) => { clearTimeout(timeoutId); pendingLiveStarts.delete(surfaceId); reject(reason); }
      });
    });
    // A source-origin event can cancel this promise while sendMessage is still
    // pending. Attach a rejection observer now; the original promise is still
    // awaited below and will still reject the startup operation.
    void acknowledgement.catch(() => {});

    stage = "delivering the stream to the Nolane canvas";
    await chrome.tabs.sendMessage(workspaceTabId, {
      type: "NOLANE_LIVE_SURFACE_START",
      surfaceId,
      sourceTabId: tab.id,
      browserSessionId: profileId,
      title: session.sourceTitle,
      url: safeUrl,
      viewport,
      streamId,
      interactive,
      interactionReason
    });
    stage = "waiting for the first decoded video frame";
    await acknowledgement;

    const confirmedSessions = await getLiveSessions();
    const videoInfo = normalizeVideoInfo(confirmedSessions[surfaceId]?.videoInfo);
    const diagnostic = {
      at: new Date().toISOString(),
      sourceOrigin: expectedOrigin,
      stage: "connected",
      errorName: "",
      errorMessage: "",
      interactive,
      keepSourceVisible: sourceKeptVisible,
      sourceTabId: tab.id,
      workspaceTabId,
      videoInfo
    };
    await chrome.storage.session.set({ [LAST_DIAGNOSTIC_KEY]: diagnostic });
    return {
      ok: true,
      surfaceId,
      title: session.sourceTitle,
      interactive,
      interactionReason,
      keepSourceVisible: sourceKeptVisible,
      workspaceWindowId
    };
  } catch (error) {
    const pending = pendingLiveStarts.get(surfaceId);
    if (pending) pending.reject(error);
    if (acknowledgement) await acknowledgement.catch(() => {});
    stoppedLiveSurfaceIds.delete(surfaceId);
    const sessions = await getLiveSessions();
    delete sessions[surfaceId];
    await saveLiveSessions(sessions);
    clearLiveInputQueue(surfaceId, "The live surface did not start.");
    if (debuggerAttached) {
      try { await chrome.debugger.detach(debuggee); } catch (_) {}
    }
    const detail = String(error?.message || error);
    const diagnostic = {
      at: new Date().toISOString(),
      sourceOrigin: expectedOrigin,
      stage,
      errorName: String(error?.name || "Error"),
      errorMessage: detail.replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
        try { return new URL(raw).origin; } catch (_) { return "[redacted URL]"; }
      }).slice(0, 500),
      interactive,
      keepSourceVisible: sourceKeptVisible,
      sourceTabId: tab.id,
      workspaceTabId
    };
    try { await chrome.storage.session.set({ [LAST_DIAGNOSTIC_KEY]: diagnostic }); } catch (_) {}
    throw new Error("Live startup failed while " + stage + ": " + detail);
  }
}
function modifierMask(message) {
  return (message.altKey ? 1 : 0) |
    (message.ctrlKey ? 2 : 0) |
    (message.metaKey ? 4 : 0) |
    (message.shiftKey ? 8 : 0);
}

function clearLiveInputQueue(surfaceId, reason) {
  const queue = liveInputQueues.get(surfaceId);
  if (!queue) return;
  queue.cancelled = true;
  liveInputQueues.delete(surfaceId);
  const error = new Error(reason || "The live surface stopped.");
  for (const item of queue.items.splice(0)) {
    item.waiters.forEach((waiter) => waiter.reject(error));
  }
}

function enqueueLiveInput(message, sender) {
  const surfaceId = typeof message.surfaceId === "string" ? message.surfaceId : "";
  if (!surfaceId) return Promise.reject(new Error("Live input has no surface identifier."));
  let queue = liveInputQueues.get(surfaceId);
  if (!queue) {
    queue = { items: [], running: false, cancelled: false };
    liveInputQueues.set(surfaceId, queue);
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    const tail = queue.items[queue.items.length - 1];
    if (message.kind === "mouseMoved" && tail?.message.kind === "mouseMoved") {
      // Keep the latest pointer position while preserving click/key/wheel ordering.
      tail.message = message;
      tail.sender = sender;
      tail.waiters.push(waiter);
      return;
    }

    if (queue.items.length >= MAX_LIVE_INPUT_QUEUE) {
      if (message.kind === "mouseMoved") {
        resolve({ ok: true, dropped: true });
        return;
      }
      const moveIndex = queue.items.findIndex((item) => item.message.kind === "mouseMoved");
      if (moveIndex >= 0) {
        const [discarded] = queue.items.splice(moveIndex, 1);
        discarded.waiters.forEach((pending) => pending.resolve({ ok: true, dropped: true }));
      } else {
        reject(new Error("The live input queue is busy. Pause briefly and try again."));
        return;
      }
    }

    queue.items.push({ message, sender, waiters: [waiter] });
    if (!queue.running) void drainLiveInputQueue(surfaceId, queue);
  });
}

async function drainLiveInputQueue(surfaceId, queue) {
  if (queue.running) return;
  queue.running = true;
  try {
    while (!queue.cancelled && queue.items.length) {
      const item = queue.items.shift();
      try {
        const result = await dispatchLiveInput(item.message, item.sender);
        item.waiters.forEach((waiter) => waiter.resolve(result));
      } catch (error) {
        item.waiters.forEach((waiter) => waiter.reject(error));
      }
    }
  } finally {
    queue.running = false;
    if (liveInputQueues.get(surfaceId) === queue) {
      if (queue.cancelled || !queue.items.length) liveInputQueues.delete(surfaceId);
      else void drainLiveInputQueue(surfaceId, queue);
    }
  }
}

async function dispatchLiveInput(message, sender) {
  if (!isWorkspaceSender(sender)) throw new Error("This live surface is no longer connected to this browser profile.");
  const sessions = await getLiveSessions();
  const session = sessions[message.surfaceId];
  if (!session || session.workspaceTabId !== sender.tab.id || session.profileId !== message.browserSessionId) {
    throw new Error("This live surface is no longer connected to this browser profile.");
  }

  const currentTab = await chrome.tabs.get(session.sourceTabId);
  if (pageOrigin(currentTab.url || "") !== session.expectedOrigin) {
    await removeLiveSession(session.surfaceId, "The source tab navigated to a different website.", true);
    throw new Error("The source website changed. Reconnect the live surface from its Chrome tab.");
  }
  if (!session.interactive || !session.debuggerAttached) {
    throw new Error(session.interactionReason || "This page is connected in video-only mode. Use Focus source to interact with it.");
  }

  const target = { tabId: session.sourceTabId };
  const x = Number(message.x);
  const y = Number(message.y);
  const validPoint = Number.isFinite(x) && Number.isFinite(y) &&
    x >= 0 && y >= 0 && x <= session.viewport.width + 2 && y <= session.viewport.height + 2;
  const modifiers = modifierMask(message);

  if (["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"].includes(message.kind)) {
    if (!validPoint) throw new Error("Pointer coordinates were outside the live surface.");
    const params = { type: message.kind, x, y, modifiers };
    if (message.kind === "mousePressed" || message.kind === "mouseReleased") {
      const buttons = ["left", "middle", "right", "back", "forward"];
      params.button = buttons.includes(message.button) ? message.button : "left";
      params.clickCount = Math.max(1, Math.min(3, Number(message.clickCount) || 1));
      params.buttons = Number(message.buttons) || (message.kind === "mousePressed" ? 1 : 0);
    } else if (message.kind === "mouseMoved") {
      params.button = "none";
      params.buttons = Number(message.buttons) || 0;
    } else if (message.kind === "mouseWheel") {
      params.deltaX = Number(message.deltaX) || 0;
      params.deltaY = Number(message.deltaY) || 0;
    }
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", params);
    return { ok: true };
  }

  if (message.kind === "keyDown" || message.kind === "keyUp") {
    const key = typeof message.key === "string" ? message.key.slice(0, 32) : "";
    const code = typeof message.code === "string" ? message.code.slice(0, 32) : "";
    if (!key && !code) throw new Error("Invalid keyboard event.");
    const params = {
      type: message.kind,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: Math.max(0, Math.min(65535, Number(message.keyCode) || 0)),
      nativeVirtualKeyCode: Math.max(0, Math.min(65535, Number(message.keyCode) || 0)),
      autoRepeat: !!message.repeat,
      location: Math.max(0, Math.min(3, Number(message.location) || 0))
    };
    if (message.kind === "keyDown" && typeof message.text === "string" && message.text.length <= 8) {
      params.text = message.text;
      params.unmodifiedText = typeof message.unmodifiedText === "string" ? message.unmodifiedText.slice(0, 8) : message.text;
    }
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", params);
    return { ok: true };
  }

  if (message.kind === "insertText") {
    if (typeof message.text !== "string" || message.text.length > 2000) throw new Error("Text input is too large.");
    await chrome.debugger.sendCommand(target, "Input.insertText", { text: message.text });
    return { ok: true };
  }

  throw new Error("Unsupported live input type.");
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!Number.isInteger(source.tabId)) return;

  if (method === "Page.frameNavigated" && params?.frame && !params.frame.parentId) {
    void (async () => {
      const sessions = await getLiveSessions();
      const session = Object.values(sessions).find((item) => item.sourceTabId === source.tabId);
      if (session && pageOrigin(params.frame.url || "") !== session.expectedOrigin) {
        await removeLiveSession(session.surfaceId, "The source tab navigated to a different website.", true);
      }
    })();
    return;
  }

  if (method === "Page.frameResized") {
    const previous = pendingViewportRefreshes.get(source.tabId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      pendingViewportRefreshes.delete(source.tabId);
      void (async () => {
        const sessions = await getLiveSessions();
        const session = Object.values(sessions).find((item) => item.sourceTabId === source.tabId);
        if (!session) return;
        try {
          const metrics = await chrome.debugger.sendCommand({ tabId: source.tabId }, "Page.getLayoutMetrics");
          const visual = metrics.cssVisualViewport || {};
          const layout = metrics.cssLayoutViewport || {};
          const viewport = {
            width: Math.max(1, Math.round(visual.clientWidth || layout.clientWidth || session.viewport.width)),
            height: Math.max(1, Math.round(visual.clientHeight || layout.clientHeight || session.viewport.height))
          };
          if (viewport.width === session.viewport.width && viewport.height === session.viewport.height) return;
          session.viewport = viewport;
          await saveLiveSessions(sessions);
          await sendToWorkspace(session, {
            type: "NOLANE_LIVE_VIEWPORT_UPDATE",
            surfaceId: session.surfaceId,
            viewport
          });
        } catch (_) {}
      })();
    }, 120);
    pendingViewportRefreshes.set(source.tabId, timer);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!Number.isInteger(source.tabId)) return;
  void removeSessionsForTab(source.tabId, reason === "canceled_by_user"
    ? "Chrome detached the page controller. Close DevTools and reconnect."
    : "The live page controller disconnected.", false);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await removeSessionsForTab(tabId, "The source Chrome tab was closed.", false);
    await removeSessionsForWorkspaceTab(tabId, "The Nolane workspace tab was closed.");
  })();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    void removeSessionsForWorkspaceTab(tabId, "The Nolane workspace reloaded; reconnect the live surface.");
  }

  // Do not rely on CDP Page.frameNavigated here: debugger may be unavailable
  // in view-only mode. Chrome's tab event still tells us when the top-level URL
  // changes, so stop the stream before showing another origin in the canvas.
  if (typeof changeInfo.url === "string") {
    void (async () => {
      const sessions = await getLiveSessions();
      const movedToAnotherOrigin = Object.values(sessions)
        .filter((session) => session.sourceTabId === tabId && pageOrigin(changeInfo.url) !== session.expectedOrigin);
      for (const session of movedToAnotherOrigin) {
        await removeLiveSession(session.surfaceId, "The source tab navigated to a different website.", true);
      }
    })();
  }
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  void (async () => {
    const sessions = await getLiveSessions();
    const matches = Object.values(sessions).filter((session) => session.sourceTabId === info.tabId);
    if (info.status === "stopped" || info.status === "error") {
      for (const session of matches) {
        await removeLiveSession(
          session.surfaceId,
          info.status === "error" ? "Chrome reported a tab-capture error." : "Chrome stopped capturing this tab.",
          true
        );
      }
      return;
    }
    if (info.status === "pending" || info.status === "active") {
      for (const session of matches) {
        session.captureStatus = info.status;
        session.captureStatusAt = Date.now();
      }
      if (matches.length) await saveLiveSessions(sessions);
    }
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;
  const respond = (promise) => {
    promise.then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  };

  if (message.type === "NOLANE_GET_PROFILE_ID") {
    return respond(profileIdPromise.then((profileId) => ({ ok: true, profileId })));
  }

  if (message.type === "NOLANE_GET_DIAGNOSTICS") {
    return respond((async () => {
      const popupUrl = chrome.runtime.getURL("popup.html");
      if (!sender.url || !sender.url.startsWith(popupUrl)) throw new Error("Diagnostics are available only from the Companion popup.");
      const [captureInfo, sessions, stored] = await Promise.all([
        chrome.tabCapture.getCapturedTabs().catch(() => []),
        getLiveSessions(),
        chrome.storage.session.get(LAST_DIAGNOSTIC_KEY)
      ]);
      return {
        ok: true,
        extensionVersion: chrome.runtime.getManifest().version,
        capturedTabs: (captureInfo || []).map((item) => ({
          tabId: item.tabId,
          status: item.status,
          fullscreen: !!item.fullscreen
        })),
        liveSessions: Object.values(sessions).map((item) => ({
          sourceTabId: item.sourceTabId,
          sourceOrigin: item.expectedOrigin,
          interactive: !!item.interactive,
          keepSourceVisible: !!item.keepSourceVisible,
          acknowledged: !!item.acknowledged,
          debuggerAttached: !!item.debuggerAttached,
          captureStatus: item.captureStatus || "unknown",
          captureStatusAt: item.captureStatusAt || null,
          healthState: normalizeHealthState(item.healthState),
          lastHealthAt: item.lastHealthAt || null,
          videoInfo: normalizeVideoInfo(item.videoInfo)
        })),
        lastLiveDiagnostic: stored[LAST_DIAGNOSTIC_KEY] || null
      };
    })());
  }

  if (message.type === "NOLANE_REGISTER_WORKSPACE") {
    return respond((async () => {
      if (!isWorkspaceSender(sender)) {
        throw new Error("Only the published Nolane workspace can register this bridge.");
      }
      await chrome.storage.session.set({ [WORKSPACE_KEY]: { tabId: sender.tab.id, url: sender.url } });
      const profileId = await profileIdPromise;
      return { ok: true, profileId };
    })());
  }

  if (message.type === "NOLANE_START_LIVE_SURFACE") {
    return respond(startLiveSurface(message, sender));
  }

  if (message.type === "NOLANE_LIVE_SURFACE_ACK") {
    return respond((async () => {
      const sessions = await getLiveSessions();
      const session = sessions[message.surfaceId];
      if (!session || !isWorkspaceSender(sender) || sender.tab.id !== session.workspaceTabId || message.browserSessionId !== session.profileId) {
        throw new Error("Live surface acknowledgement did not match an active session.");
      }
      session.acknowledged = true;
      session.videoInfo = normalizeVideoInfo(message.videoInfo);
      await saveLiveSessions(sessions);
      const pending = pendingLiveStarts.get(message.surfaceId);
      if (pending) pending.resolve();
      return { ok: true };
    })());
  }

  if (message.type === "NOLANE_LIVE_SURFACE_HEALTH") {
    return respond((async () => {
      const sessions = await getLiveSessions();
      const session = sessions[message.surfaceId];
      if (!session || !isWorkspaceSender(sender) || sender.tab.id !== session.workspaceTabId ||
          message.browserSessionId !== session.profileId) {
        return { ok: false, error: "Live health update did not match an active workspace session." };
      }
      session.healthState = normalizeHealthState(message.healthState);
      session.lastHealthAt = Date.now();
      const videoInfo = normalizeVideoInfo(message.videoInfo);
      if (videoInfo) session.videoInfo = videoInfo;
      await saveLiveSessions(sessions);
      const stored = await chrome.storage.session.get(LAST_DIAGNOSTIC_KEY);
      const previous = stored[LAST_DIAGNOSTIC_KEY] || {};
      await chrome.storage.session.set({
        [LAST_DIAGNOSTIC_KEY]: {
          ...previous,
          healthState: session.healthState,
          healthUpdatedAt: new Date(session.lastHealthAt).toISOString(),
          videoInfo: session.videoInfo || null
        }
      });
      return { ok: true };
    })());
  }

  if (message.type === "NOLANE_LIVE_SURFACE_ERROR") {
    return respond((async () => {
      const sessions = await getLiveSessions();
      const session = sessions[message.surfaceId];
      if (!session || !isWorkspaceSender(sender) || sender.tab.id !== session.workspaceTabId || message.browserSessionId !== session.profileId) return { ok: true };
      const failure = "Live stream failed: " + String(message.error || "Unknown capture error").slice(0, 180);
      const pending = pendingLiveStarts.get(message.surfaceId);
      if (pending) pending.reject(new Error(failure));
      await removeLiveSession(session.surfaceId, failure, false);
      return { ok: true };
    })());
  }

  if (message.type === "NOLANE_STOP_LIVE_SURFACE") {
    return respond((async () => {
      const sessions = await getLiveSessions();
      const session = sessions[message.surfaceId];
      if (!session || !isWorkspaceSender(sender) || sender.tab.id !== session.workspaceTabId || message.browserSessionId !== session.profileId) return { ok: true };
      await removeLiveSession(session.surfaceId, "Live surface stopped by the workspace.", false);
      return { ok: true };
    })());
  }

  if (message.type === "NOLANE_STOP_TAB") {
    return respond((async () => {
      const popupUrl = chrome.runtime.getURL("popup.html");
      if (!sender.url || !sender.url.startsWith(popupUrl)) throw new Error("Stop capture from the Companion popup.");
      const sessions = await getLiveSessions();
      const matches = Object.values(sessions).filter((session) => session.sourceTabId === message.tabId);
      for (const session of matches) await removeLiveSession(session.surfaceId, "Live stream stopped.", true);
      return { ok: true };
    })());
  }

  if (message.type === "NOLANE_LIVE_INPUT") {
    return respond(enqueueLiveInput(message, sender));
  }

  if (message.type === "NOLANE_FOCUS_TAB" && Number.isInteger(message.tabId)) {
    return respond((async () => {
      if (!isWorkspaceSender(sender)) throw new Error("Only Nolane can focus a saved Chrome tab.");
      const profileId = await profileIdPromise;
      if (message.profileId !== profileId) throw new Error("This card belongs to a different Chrome profile. Import the tab again from this browser.");
      const tab = await chrome.tabs.get(message.tabId);
      if (message.expectedOrigin && pageOrigin(tab.url || "") !== message.expectedOrigin) {
        throw new Error("The saved tab ID now points to a different website.");
      }
      await chrome.tabs.update(message.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    })());
  }
});
