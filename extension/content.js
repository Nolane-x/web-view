(() => {
  "use strict";
  const WORKSPACE_ORIGIN = "https://nolane-x.github.io";

  function sendToPage(type, payload) {
    window.postMessage({
      source: "nolane-companion",
      type,
      ...(payload || {})
    }, WORKSPACE_ORIGIN);
  }

  function onPageMessage(event) {
    if (event.source !== window || event.origin !== WORKSPACE_ORIGIN) return;
    const message = event.data;
    if (!message || message.source !== "nolane-workspace") return;

    if (message.type === "PING_COMPANION") {
      chrome.runtime.sendMessage({ type: "NOLANE_GET_PROFILE_ID" })
        .then((result) => sendToPage("COMPANION_READY", { version: "0.1.0", browserSessionId: result?.profileId || "" }))
        .catch(() => sendToPage("COMPANION_READY", { version: "0.1.0", browserSessionId: "" }));
      return;
    }

    if (message.type === "FOCUS_BROWSER_TAB" && Number.isInteger(message.tabId)) {
      chrome.runtime.sendMessage({
        type: "NOLANE_FOCUS_TAB",
        tabId: message.tabId,
        profileId: message.browserSessionId,
        expectedOrigin: message.expectedOrigin
      })
        .then((result) => sendToPage("TAB_FOCUSED", {
          tabId: message.tabId,
          browserSessionId: message.browserSessionId,
          ok: !!result?.ok,
          error: result?.error || ""
        }))
        .catch((error) => sendToPage("TAB_FOCUSED", {
          tabId: message.tabId,
          browserSessionId: message.browserSessionId,
          ok: false,
          error: String(error?.message || error)
        }));
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "NOLANE_IMPORT_TABS" || !Array.isArray(message.tabs)) return;
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
    return true;
  });

  window.addEventListener("message", onPageMessage);
  chrome.runtime.sendMessage({ type: "NOLANE_GET_PROFILE_ID" })
    .then((result) => sendToPage("COMPANION_READY", { version: "0.1.0", browserSessionId: result?.profileId || "" }))
    .catch(() => {});
})();