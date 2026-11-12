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
      sendToPage("COMPANION_READY", { version: "0.1.0" });
      return;
    }

    if (message.type === "FOCUS_BROWSER_TAB" && Number.isInteger(message.tabId)) {
      chrome.runtime.sendMessage({ type: "NOLANE_FOCUS_TAB", tabId: message.tabId })
        .then((result) => sendToPage("TAB_FOCUSED", { tabId: message.tabId, ok: !!result?.ok, error: result?.error || "" }))
        .catch((error) => sendToPage("TAB_FOCUSED", { tabId: message.tabId, ok: false, error: String(error?.message || error) }));
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
    sendToPage("TABS_IMPORTED", { tabs: selected });
    sendResponse({ ok: true, count: selected.length });
    return true;
  });

  window.addEventListener("message", onPageMessage);
  sendToPage("COMPANION_READY", { version: "0.1.0" });
})();