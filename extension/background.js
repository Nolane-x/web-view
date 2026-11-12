"use strict";

const WORKSPACE_ORIGIN = "https://nolane-x.github.io";
const WORKSPACE_URL_PREFIX = WORKSPACE_ORIGIN + "/web-view/";
const PROFILE_KEY = "nolaneProfileId";
const WORKSPACE_KEY = "nolaneWorkspaceTab";
const LIVE_SESSIONS_KEY = "nolaneLiveSessions";
const LIVE_START_TIMEOUT_MS = 12000;
const MAX_LIVE_SURFACES_PER_WORKSPACE = 3;
const pendingLiveStarts = new Map();
const pendingViewportRefreshes = new Map();

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

function pageOrigin(value) {
  try { return new URL(value).origin; } catch (_) { return ""; }
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
  await saveLiveSessions(sessions);
  const viewportTimer = pendingViewportRefreshes.get(session.sourceTabId);
  if (viewportTimer) clearTimeout(viewportTimer);
  pendingViewportRefreshes.delete(session.sourceTabId);
  if (detachDebugger) {
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
  const safeUrl = cleanShareUrl(tab.url || "");
  const expectedOrigin = pageOrigin(tab.url || "");
  if (!safeUrl || !expectedOrigin) {
    throw new Error("Chrome cannot stream this page. Use a normal http:// or https:// website tab.");
  }

  const surfaceId = crypto.randomUUID();
  const debuggee = { tabId: tab.id };
  let debuggerAttached = false;

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    debuggerAttached = true;
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    const metrics = await chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics");
    const visual = metrics.cssVisualViewport || {};
    const layout = metrics.cssLayoutViewport || {};
    const viewport = {
      width: Math.max(1, Math.round(visual.clientWidth || layout.clientWidth || tab.width || 1280)),
      height: Math.max(1, Math.round(visual.clientHeight || layout.clientHeight || tab.height || 720))
    };

    // Stream tokens are single-use and expire quickly, so request one immediately before delivery.
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
      consumerTabId: workspaceTabId
    });

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
      acknowledged: false
    };
    const sessions = await getLiveSessions();
    sessions[surfaceId] = session;
    await saveLiveSessions(sessions);

    const acknowledgement = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingLiveStarts.delete(surfaceId);
        reject(new Error("Nolane did not confirm that the live video stream was attached. Refresh the workspace and try again."));
      }, LIVE_START_TIMEOUT_MS);
      pendingLiveStarts.set(surfaceId, {
        resolve: () => { clearTimeout(timeoutId); pendingLiveStarts.delete(surfaceId); resolve(); },
        reject: (reason) => { clearTimeout(timeoutId); pendingLiveStarts.delete(surfaceId); reject(reason); }
      });
    });

    await chrome.tabs.sendMessage(workspaceTabId, {
      type: "NOLANE_LIVE_SURFACE_START",
      surfaceId,
      sourceTabId: tab.id,
      browserSessionId: profileId,
      title: session.sourceTitle,
      url: safeUrl,
      viewport,
      streamId
    });
    await acknowledgement;

    // Once the workspace has consumed the stream, bring the canvas back into view.
    const workspaceTab = await chrome.tabs.get(workspaceTabId);
    await chrome.tabs.update(workspaceTabId, { active: true });
    await chrome.windows.update(workspaceTab.windowId, { focused: true });
    return { ok: true, surfaceId, title: session.sourceTitle };
  } catch (error) {
    const pending = pendingLiveStarts.get(surfaceId);
    if (pending) pending.reject(error);
    if (debuggerAttached) {
      try { await chrome.debugger.detach(debuggee); } catch (_) {}
    }
    const sessions = await getLiveSessions();
    delete sessions[surfaceId];
    await saveLiveSessions(sessions);
    throw error;
  }
}

function modifierMask(message) {
  return (message.altKey ? 1 : 0) |
    (message.ctrlKey ? 2 : 0) |
    (message.metaKey ? 4 : 0) |
    (message.shiftKey ? 8 : 0);
}

async function dispatchLiveInput(message, sender) {
  if (!Number.isInteger(sender.tab?.id)) throw new Error("Input sender is not a Nolane workspace tab.");
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
  void removeSessionsForTab(tabId, "The source Chrome tab was closed.", false);
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  if (info.status === "stopped" || info.status === "error") {
    void removeSessionsForTab(info.tabId, "Chrome stopped capturing this tab.", true);
  }
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

  if (message.type === "NOLANE_REGISTER_WORKSPACE") {
    return respond((async () => {
      if (!sender.tab || !sender.url || !sender.url.startsWith(WORKSPACE_URL_PREFIX)) {
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
      if (!session || sender.tab?.id !== session.workspaceTabId || message.browserSessionId !== session.profileId) {
        throw new Error("Live surface acknowledgement did not match an active session.");
      }
      session.acknowledged = true;
      await saveLiveSessions(sessions);
      const pending = pendingLiveStarts.get(message.surfaceId);
      if (pending) pending.resolve();
      return { ok: true };
    })());
  }

  if (message.type === "NOLANE_LIVE_SURFACE_ERROR") {
    return respond((async () => {
      const sessions = await getLiveSessions();
      const session = sessions[message.surfaceId];
      if (!session || sender.tab?.id !== session.workspaceTabId) return { ok: true };
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
      if (!session || sender.tab?.id !== session.workspaceTabId || message.browserSessionId !== session.profileId) return { ok: true };
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
    return respond(dispatchLiveInput(message, sender));
  }

  if (message.type === "NOLANE_FOCUS_TAB" && Number.isInteger(message.tabId)) {
    return respond((async () => {
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
