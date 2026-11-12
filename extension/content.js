(() => {
  "use strict";
  const WORKSPACE_ORIGIN = "https://nolane-x.github.io";
  const PROFILE_VERSION = "0.2.4";

  function sendToPage(type, payload) {
    window.postMessage({ source: "nolane-companion", type, ...(payload || {}) }, WORKSPACE_ORIGIN);
  }

  function sendRuntime(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  function onPageMessage(event) {
    if (event.source !== window || event.origin !== WORKSPACE_ORIGIN) return;
    const message = event.data;
    if (!message || message.source !== "nolane-workspace") return;

    if (message.type === "PING_COMPANION") {
      chrome.runtime.sendMessage({ type: "NOLANE_GET_PROFILE_ID" })
        .then((result) => sendToPage("COMPANION_READY", {
          version: PROFILE_VERSION,
          browserSessionId: result?.profileId || ""
        }))
        .catch(() => sendToPage("COMPANION_READY", { version: PROFILE_VERSION, browserSessionId: "" }));
      return;
    }

    if (message.type === "FOCUS_BROWSER_TAB" && Number.isInteger(message.tabId)) {
      chrome.runtime.sendMessage({
        type: "NOLANE_FOCUS_TAB",
        tabId: message.tabId,
        profileId: message.browserSessionId,
        expectedOrigin: message.expectedOrigin
      }).then((result) => sendToPage("TAB_FOCUSED", {
        tabId: message.tabId,
        browserSessionId: message.browserSessionId,
        ok: !!result?.ok,
        error: result?.error || ""
      })).catch((error) => sendToPage("TAB_FOCUSED", {
        tabId: message.tabId,
        browserSessionId: message.browserSessionId,
        ok: false,
        error: String(error?.message || error)
      }));
      return;
    }

    if (message.type === "LIVE_INPUT" && typeof message.surfaceId === "string") {
      const payload = {
        type: "NOLANE_LIVE_INPUT",
        surfaceId: message.surfaceId,
        browserSessionId: String(message.browserSessionId || ""),
        kind: String(message.kind || "")
      };
      for (const key of ["x", "y", "deltaX", "deltaY", "buttons", "clickCount", "keyCode", "location"]) {
        if (Number.isFinite(message[key])) payload[key] = message[key];
      }
      for (const key of ["button", "key", "code", "text", "unmodifiedText"]) {
        if (typeof message[key] === "string") payload[key] = message[key].slice(0, 2000);
      }
      for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat"]) payload[key] = !!message[key];
      sendRuntime(payload);
      return;
    }

    if (message.type === "LIVE_SURFACE_ACK" && typeof message.surfaceId === "string") {
      sendRuntime({
        type: "NOLANE_LIVE_SURFACE_ACK",
        surfaceId: message.surfaceId,
        browserSessionId: String(message.browserSessionId || ""),
        videoInfo: message.videoInfo && typeof message.videoInfo === "object" ? {
          width: Number.isFinite(message.videoInfo.width) ? message.videoInfo.width : null,
          height: Number.isFinite(message.videoInfo.height) ? message.videoInfo.height : null,
          frameRate: Number.isFinite(message.videoInfo.frameRate) ? message.videoInfo.frameRate : null,
          presentedFrames: Number.isFinite(message.videoInfo.presentedFrames) ? message.videoInfo.presentedFrames : null,
          mediaTime: Number.isFinite(message.videoInfo.mediaTime) ? message.videoInfo.mediaTime : null,
          trackReadyState: message.videoInfo.trackReadyState === "live" || message.videoInfo.trackReadyState === "ended" ? message.videoInfo.trackReadyState : "unknown",
          trackMuted: !!message.videoInfo.trackMuted
        } : null
      });
      return;
    }

    if (message.type === "LIVE_SURFACE_ERROR" && typeof message.surfaceId === "string") {
      sendRuntime({
        type: "NOLANE_LIVE_SURFACE_ERROR",
        surfaceId: message.surfaceId,
        browserSessionId: String(message.browserSessionId || ""),
        error: String(message.error || "Could not create the live stream").slice(0, 220)
      });
      return;
    }

    if (message.type === "LIVE_SURFACE_STOP" && typeof message.surfaceId === "string") {
      sendRuntime({
        type: "NOLANE_STOP_LIVE_SURFACE",
        surfaceId: message.surfaceId,
        browserSessionId: String(message.browserSessionId || "")
      });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "NOLANE_IMPORT_TABS" && Array.isArray(message.tabs)) {
      const selected = message.tabs.slice(0, 150).filter((tab) =>
        tab && Number.isInteger(tab.id) &&
        typeof tab.url === "string" &&
        (tab.url.startsWith("https://") || tab.url.startsWith("http://"))
      ).map((tab) => ({
        id: tab.id,
        windowId: Number.isInteger(tab.windowId) ? tab.windowId : undefined,
        url: tab.url,
        title: String(tab.title || tab.url).slice(0, 120)
      }));
      sendToPage("TABS_IMPORTED", { tabs: selected, browserSessionId: String(message.browserSessionId || "") });
      sendResponse({ ok: true, count: selected.length });
      return;
    }

    if (message.type === "NOLANE_LIVE_SURFACE_START") {
      sendToPage("LIVE_SURFACE_START", {
        surfaceId: message.surfaceId,
        sourceTabId: message.sourceTabId,
        browserSessionId: message.browserSessionId,
        title: message.title,
        url: message.url,
        viewport: message.viewport,
        streamId: message.streamId,
        interactive: !!message.interactive,
        interactionReason: String(message.interactionReason || "").slice(0, 360),
        keepSourceVisible: !!message.keepSourceVisible
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "NOLANE_LIVE_VIEWPORT_UPDATE") {
      sendToPage("LIVE_VIEWPORT_UPDATE", { surfaceId: message.surfaceId, viewport: message.viewport });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "NOLANE_LIVE_SURFACE_STOPPED") {
      sendToPage("LIVE_SURFACE_STOPPED", {
        surfaceId: message.surfaceId,
        reason: message.reason || "The live surface stopped."
      });
      sendResponse({ ok: true });
    }
  });

  window.addEventListener("message", onPageMessage);
  chrome.runtime.sendMessage({ type: "NOLANE_REGISTER_WORKSPACE" })
    .then((result) => sendToPage("COMPANION_READY", {
      version: PROFILE_VERSION,
      browserSessionId: result?.profileId || ""
    }))
    .catch(() => {});
})();
