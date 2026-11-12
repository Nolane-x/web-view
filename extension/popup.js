(() => {
  "use strict";
  const WORKSPACE_URL = "https://nolane-x.github.io/web-view/";
  const WORKSPACE_MATCH = "https://nolane-x.github.io/web-view/*";
  const $ = (selector) => document.querySelector(selector);
  let availableTabs = [];

  function status(message, kind) {
    const element = $("#status");
    element.textContent = message;
    element.className = "status" + (kind ? " " + kind : "");
  }

  function isWorkspaceTab(tab) {
    return typeof tab.url === "string" && tab.url.startsWith(WORKSPACE_URL);
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
      // URL fragments often contain OAuth implicit-flow tokens; do not export them.
      url.hash = "";
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function safeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return "Website"; }
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
      checkbox.checked = false;
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
    else status("Tab-list permission has not been granted.");
  }

  async function grantPermission() {
    try {
      const granted = await chrome.permissions.request({ permissions: ["tabs"] });
      if (!granted) {
        status("Permission was not granted. You can still use Nolane without importing tabs.", "error");
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
        .filter((tab) => !!tab.url)
        .filter((tab) => !isWorkspaceTab(tab))
        .sort((a, b) => Number(!!b.active) - Number(!!a.active));
      renderTabs();
      status(availableTabs.length ? "Choose tabs, then import them into your active Nolane workspace." : "No web tabs are available to import.", "success");
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
        status("Opened Nolane Infinite. Reopen this extension and import the selected tabs.", "success");
        return;
      }
      const result = await chrome.tabs.sendMessage(workspaceTab.id, { type: "NOLANE_IMPORT_TABS", tabs: selected, browserSessionId: profile.profileId });
      if (!result || !result.ok) throw new Error("The workspace did not accept the selected tabs.");
      status("Imported " + result.count + " tab(s) into Nolane. You can close this popup.", "success");
    } catch (error) {
      status("Could not reach Nolane. Refresh the workspace page and try again. " + (error.message || ""), "error");
    }
  }

  $("#grantButton").addEventListener("click", grantPermission);
  $("#refreshButton").addEventListener("click", refreshTabs);
  $("#selectAllButton").addEventListener("click", () => {
    $("#tabList").querySelectorAll("input").forEach((input) => { input.checked = true; });
    updateImportButton();
  });
  $("#tabList").addEventListener("change", updateImportButton);
  $("#importButton").addEventListener("click", importSelected);
  $("#openWorkspaceButton").addEventListener("click", () => chrome.tabs.create({ url: WORKSPACE_URL }));
  checkPermission().catch((error) => status(error.message || String(error), "error"));
})();