const profileIdPromise = chrome.storage.local.get(["nolaneProfileId"]).then(async (stored) => {
  if (typeof stored.nolaneProfileId === "string" && stored.nolaneProfileId.length > 20) {
    return stored.nolaneProfileId;
  }
  const profileId = crypto.randomUUID();
  await chrome.storage.local.set({ nolaneProfileId: profileId });
  return profileId;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "NOLANE_GET_PROFILE_ID") {
    profileIdPromise
      .then((profileId) => sendResponse({ ok: true, profileId }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "NOLANE_FOCUS_TAB" && Number.isInteger(message.tabId)) {
    profileIdPromise
      .then(async (profileId) => {
        if (message.profileId !== profileId) {
          throw new Error("This card belongs to a different Chrome profile. Import the tab again from this browser.");
        }
        const tab = await chrome.tabs.get(message.tabId);
        if (message.expectedOrigin) {
          let actualOrigin = "";
          try { actualOrigin = new URL(tab.url || "").origin; } catch (_) {}
          if (actualOrigin !== message.expectedOrigin) {
            throw new Error("The saved tab ID now points to a different website.");
          }
        }
        await chrome.tabs.update(message.tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return { ok: true };
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});