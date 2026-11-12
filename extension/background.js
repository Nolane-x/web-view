chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "NOLANE_FOCUS_TAB" || !Number.isInteger(message.tabId)) return;

  chrome.tabs.get(message.tabId)
    .then((tab) => chrome.tabs.update(message.tabId, { active: true }).then(() => tab))
    .then((tab) => chrome.windows.update(tab.windowId, { focused: true }))
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});