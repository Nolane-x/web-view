(() => {
  "use strict";
  const WORKSPACE_URL = "https://nolane-x.github.io/web-view/";
  const WORKSPACE_MATCH = "https://nolane-x.github.io/web-view/*";
  const $ = (selector) => document.querySelector(selector);
  let availableTabs = [];
  let activeTab = null;

  function status(message, kind) {
    const element = $("#status");
    element.textContent = message;
    element.className = "status" + (kind ? " " + kind : "");
  }

  function isWorkspaceTab(tab) {
    return typeof tab?.url === "string" && tab.url.startsWith(WORKSPACE_URL);
  }

  function sanitizeTabUrl(raw) {
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      for (const key of [...url.searchParams.keys()]) {
        if (/(token|secret|password|passwd|credential|authorization|auth|access.?key|api.?key|signature|^sig$|^jwt$|^code$|id.?token|refresh.?token|session.?id|^nonce$|^state$)/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      url.hash = "";
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function safeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return "Website"; }
  }

  async function refreshActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTab = tab || null;
      const title = $("#activeTabTitle");
      const details = $("#activeTabDescription");
      const button = $("#liveButton");
      if (!activeTab) {
        title.textContent = "No active tab found";
        details.textContent = "Open a normal website tab first.";
        button.disabled = true;
        return;
      }
      title.textContent = activeTab.title || safeHost(activeTab.url || "");
      if (isWorkspaceTab(activeTab)) {
        details.textContent = "This is the workspace tab. Switch to the website you want to stream, then open the Companion there.";
        button.disabled = true;
      } else if (!sanitizeTabUrl(activeTab.url || "")) {
        details.textContent = "This page cannot be streamed. Open a normal http:// or https:// website.";
        button.disabled = true;
      } else {
        details.textContent = safeHost(activeTab.url) + " is ready. Nolane must already be open in another tab.";
        button.disabled = false;
      }
    } catch (error) {
      status("Could not inspect the active tab: " + (error.message || error), "error");
    }
  }

  async function startLiveSurface() {
    if (!activeTab || !Number.isInteger(activeTab.id)) return;
    $("#liveButton").disabled = true;
    status("Starting a local tab stream…");
    try {
      const result = await chrome.runtime.sendMessage({
        type: "NOLANE_START_LIVE_SURFACE",
        tabId: activeTab.id
      });
      if (!result || !result.ok) throw new Error(result?.error || "The workspace did not accept the stream.");
      if (result.interactive) {
        status("Interactive live surface started for " + (result.title || safeHost(activeTab.url)) + ".", "success");
      } else {
        status("Live video connected in view-only mode. " + (result.interactionReason || "Use Focus source to interact with the tab."), "success");
      }
      $("#stopLiveButton").hidden = false;
    } catch (error) {
      status("Could not start live surface: " + (error.message || error), "error");
    } finally {
      await refreshActiveTab();
    }
  }

  async function stopLiveSurface() {
    if (!activeTab || !Number.isInteger(activeTab.id)) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "NOLANE_STOP_TAB", tabId: activeTab.id });
      if (!result?.ok) throw new Error(result?.error || "Could not stop this tab stream.");
      status("Live stream stopped.", "success");
      $("#stopLiveButton").hidden = true;
    } catch (error) {
      status(error.message || String(error), "error");
    }
  }

  function renderTabs() {
    const list = $("#tabList");
    list.replaceChildren();
    $("#tabCount").textContent = availableTabs.length
      ? availableTabs.length + " web tab(s). Select the ones to add."
      : "No regular web tabs were found.";
    availableTabs.forEach((tab) => {
      const label = document.createElement("label");
      label.className = "tab-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.tabId = String(tab.id);
      const info = document.createElement("span");
      info.className = "tab-info";
      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.title || safeHost(tab.url);
      const url = document.createElement("span");
      url.className = "tab-url";
      url.textContent = safeHost(tab.url);
      info.append(title, url);
      label.append(checkbox, info);
      list.appendChild(label);
    });
    updateImportButton();
  }

  function updateImportButton() {
    const count = $("#tabList").querySelectorAll("input:checked").length;
    $("#importButton").disabled = count === 0;
    $("#importButton").textContent = count ? "Import " + count + " selected" : "Import selected";
  }

  async function checkPermission() {
    const allowed = await chrome.permissions.contains({ permissions: ["tabs"] });
    $("#permissionPanel").hidden = allowed;
    $("#tabsPanel").hidden = !allowed;
    if (allowed) await refreshTabs();
  }

  async function grantPermission() {
    try {
      const granted = await chrome.permissions.request({ permissions: ["tabs"] });
      if (!granted) {
        status("Tab-list permission was not granted. Live streaming still works without it.", "error");
        return;
      }
      $("#permissionPanel").hidden = true;
      $("#tabsPanel").hidden = false;
      await refreshTabs();
    } catch (error) {
      status("Could not request permission: " + (error.message || error), "error");
    }
  }

  async function refreshTabs() {
    try {
      availableTabs = (await chrome.tabs.query({}))
        .filter((tab) => Number.isInteger(tab.id) && typeof tab.url === "string")
        .map((tab) => ({ ...tab, url: sanitizeTabUrl(tab.url) }))
        .filter((tab) => !!tab.url && !isWorkspaceTab(tab))
        .sort((a, b) => Number(!!b.active) - Number(!!a.active));
      renderTabs();
      status(availableTabs.length ? "Choose tabs, then import their links as cards. Use Live Chrome Surface for an interactive view." : "No regular web tabs were found.");
    } catch (error) {
      status("Could not list tabs: " + (error.message || error), "error");
    }
  }

  async function findWorkspaceTab() {
    const tabs = await chrome.tabs.query({ url: WORKSPACE_MATCH });
    const active = tabs.find((tab) => tab.active);
    return active || tabs[0] || null;
  }

  async function importSelected() {
    const selectedIds = new Set(
      [...$("#tabList").querySelectorAll("input:checked")].map((input) => Number(input.dataset.tabId))
    );
    const selected = availableTabs.filter((tab) => selectedIds.has(tab.id)).map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title
    }));
    if (!selected.length) return;

    try {
      const profile = await chrome.runtime.sendMessage({ type: "NOLANE_GET_PROFILE_ID" });
      if (!profile || !profile.ok || !profile.profileId) throw new Error("Could not identify this Chrome profile.");
      const workspaceTab = await findWorkspaceTab();
      if (!workspaceTab) {
        await chrome.tabs.create({ url: WORKSPACE_URL });
        status("Opened Nolane Infinite. Reopen the extension and import the selected tabs.", "success");
        return;
      }
      const result = await chrome.tabs.sendMessage(workspaceTab.id, {
        type: "NOLANE_IMPORT_TABS",
        tabs: selected,
        browserSessionId: profile.profileId
      });
      if (!result || !result.ok) throw new Error("The workspace did not accept the selected tabs.");
      status("Imported " + result.count + " tab(s) into Nolane.", "success");
    } catch (error) {
      status("Could not reach Nolane. Refresh the workspace page and try again. " + (error.message || ""), "error");
    }
  }

  $("#liveButton").addEventListener("click", startLiveSurface);
  $("#stopLiveButton").addEventListener("click", stopLiveSurface);
  $("#grantButton").addEventListener("click", grantPermission);
  $("#refreshButton").addEventListener("click", refreshTabs);
  $("#selectAllButton").addEventListener("click", () => {
    $("#tabList").querySelectorAll("input").forEach((input) => { input.checked = true; });
    updateImportButton();
  });
  $("#tabList").addEventListener("change", updateImportButton);
  $("#importButton").addEventListener("click", importSelected);
  $("#openWorkspaceButton").addEventListener("click", () => chrome.tabs.create({ url: WORKSPACE_URL }));
  refreshActiveTab().catch((error) => status(error.message || String(error), "error"));
  checkPermission().catch((error) => status(error.message || String(error), "error"));
})();
