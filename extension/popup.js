(() => {
  "use strict";
  const WORKSPACE_URL = "https://nolane-x.github.io/web-view/";
  const WORKSPACE_MATCH = "https://nolane-x.github.io/web-view/*";
  const $ = (selector) => document.querySelector(selector);
  let availableTabs = [];
  let activeTab = null;
  let workspaceStatus = { state: "checking", reason: "Checking for an open Nolane workspace…" };

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

  function updateWorkspaceButton() {
    const button = $("#openWorkspaceButton");
    const title = $("#workspaceStatusTitle");
    const details = $("#workspaceStatusText");
    const pill = $("#workspaceStatusPill");
    if (workspaceStatus.state === "connected") {
      button.textContent = "Focus Nolane Infinite";
      title.textContent = "Nolane Infinite is connected";
      details.textContent = "The workspace tab and current Browser Companion bridge were both verified.";
      pill.textContent = "Connected";
      pill.dataset.state = "connected";
    } else if (workspaceStatus.state === "refresh-required") {
      button.textContent = "Reconnect Nolane Infinite";
      title.textContent = "Nolane was found, but needs reconnecting";
      details.textContent = workspaceStatus.reason || "Refresh the existing Nolane tab to reload its Companion bridge.";
      pill.textContent = "Refresh needed";
      pill.dataset.state = "warning";
    } else if (workspaceStatus.state === "loading") {
      button.textContent = "Focus loading Nolane";
      title.textContent = "Nolane Infinite is still loading";
      details.textContent = workspaceStatus.reason || "Wait for the page to finish loading, then reopen the Companion.";
      pill.textContent = "Loading";
      pill.dataset.state = "loading";
    } else if (workspaceStatus.state === "lookup-unavailable") {
      button.textContent = "Retry workspace check";
      title.textContent = "Chrome could not verify Nolane";
      details.textContent = workspaceStatus.reason || "Retry the workspace check.";
      pill.textContent = "Check failed";
      pill.dataset.state = "warning";
    } else if (workspaceStatus.state === "checking") {
      button.textContent = "Checking Nolane Infinite…";
      title.textContent = "Checking workspace connection";
      details.textContent = workspaceStatus.reason || "Searching open Chrome tabs and checking the Companion bridge.";
      pill.textContent = "Checking";
      pill.dataset.state = "loading";
    } else {
      button.textContent = "Open Nolane Infinite";
      title.textContent = "Nolane Infinite is not open";
      details.textContent = workspaceStatus.reason || "Open Nolane Infinite in a Chrome tab before starting a live stream.";
      pill.textContent = "Not open";
      pill.dataset.state = "missing";
    }
  }

  function updateActiveTabPresentation() {
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
      return;
    }
    if (!sanitizeTabUrl(activeTab.url || "")) {
      details.textContent = "This page cannot be streamed. Open a normal http:// or https:// website.";
      button.disabled = true;
      return;
    }
    const host = safeHost(activeTab.url);
    if (workspaceStatus.state === "connected") {
      details.textContent = host + " is ready. Nolane Infinite is connected in another tab.";
      button.disabled = false;
    } else if (workspaceStatus.state === "refresh-required") {
      details.textContent = host + " is ready, but Nolane was found in another tab and its Companion bridge needs a refresh. Use Reconnect Nolane Infinite below.";
      button.disabled = true;
    } else if (workspaceStatus.state === "loading") {
      details.textContent = host + " is ready, but Nolane Infinite is still loading. Wait for it to finish, then reopen the Companion.";
      button.disabled = true;
    } else if (workspaceStatus.state === "lookup-unavailable") {
      details.textContent = host + " is ready, but Chrome could not verify the Nolane workspace. Retry the workspace check below.";
      button.disabled = true;
    } else {
      details.textContent = host + " is ready, but Nolane Infinite is not open. Open it below before streaming.";
      button.disabled = true;
    }
  }

  async function refreshWorkspaceStatus() {
    try {
      const result = await chrome.runtime.sendMessage({ type: "NOLANE_GET_WORKSPACE_STATUS" });
      if (!result?.ok) throw new Error(result?.error || "Could not check the Nolane workspace.");
      workspaceStatus = result;
    } catch (error) {
      workspaceStatus = { state: "lookup-unavailable", reason: String(error?.message || error) };
    }
    updateWorkspaceButton();
    updateActiveTabPresentation();
    return workspaceStatus;
  }

  async function refreshActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTab = tab || null;
      updateActiveTabPresentation();
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
        tabId: activeTab.id,
        keepSourceVisible: $("#keepSourceVisible").checked
      });
      if (!result || !result.ok) throw new Error(result?.error || "The workspace did not accept the stream.");
      const visibilityNote = result.keepSourceVisible
        ? " Source tab stays selected in its own Chrome window."
        : " Source tab may enter the background and some sites may pause.";
      if (result.interactive) {
        status("Interactive live surface started for " + (result.title || safeHost(activeTab.url)) + "." + visibilityNote, "success");
      } else {
        status("Live video connected in view-only mode. " + (result.interactionReason || "Use Focus source to interact with the tab.") + visibilityNote, "success");
      }
      $("#stopLiveButton").hidden = false;
    } catch (error) {
      status("Could not start live surface: " + (error.message || error), "error");
    } finally {
      await refreshWorkspaceStatus();
      await refreshActiveTab();
    }
  }



  function renderCompatibilityResult(result) {
    const panel = $("#compatibilityResult");
    panel.replaceChildren();
    panel.hidden = false;
    panel.className = "compat-result " + (result.diagnosis?.severity || "info");
    const category = document.createElement("div");
    category.className = "compat-category";
    category.textContent = (result.site?.label || "Website") + " · " + (result.site?.confidence || "unknown") + " match";
    const title = document.createElement("strong");
    title.className = "compat-title";
    title.textContent = result.diagnosis?.title || "Analysis complete";
    const summary = document.createElement("p");
    summary.className = "compat-summary";
    summary.textContent = result.diagnosis?.summary || "No compatibility details were returned.";
    const code = document.createElement("code");
    code.textContent = result.diagnosis?.code || "UNKNOWN";
    const actions = document.createElement("ul");
    (result.diagnosis?.actions || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      actions.appendChild(li);
    });
    const hints = document.createElement("div");
    hints.className = "compat-hints";
    (result.diagnosis?.hints || []).forEach((item) => {
      const p = document.createElement("p");
      p.textContent = item;
      hints.appendChild(p);
    });
    const recovery = document.createElement("div");
    recovery.className = "compat-recovery";
    recovery.textContent = "Suggested action: " + (result.diagnosis?.recovery?.label || "Inspect status") +
      (result.diagnosis?.recovery?.reason ? " — " + result.diagnosis.recovery.reason : "");
    const history = document.createElement("div");
    history.className = "compat-history";
    if (result.profile) {
      history.textContent = "Local history · " + result.profile.attempts + " attempts · " +
        result.profile.successes + " successful · " + result.profile.failures + " failed · " +
        result.profile.healthTransitions + " health changes";
    } else {
      history.textContent = "No local history for this website origin yet.";
    }
    const apply = document.createElement("button");
    apply.className = "compat-apply";
    apply.type = "button";
    apply.textContent = result.diagnosis?.recovery?.label || "Inspect status";
    apply.disabled = !result.diagnosis?.recovery || ["none", "inspect"].includes(result.diagnosis.recovery.action);
    apply.addEventListener("click", () => applyCompatibilityRecommendation(result.diagnosis.recovery.action));
    panel.append(category, title, summary, code, actions, recovery, apply, hints, history);
  }


  async function applyCompatibilityRecommendation(action) {
    if (!activeTab || !Number.isInteger(activeTab.id)) return;
    const button = $("#compatibilityResult .compat-apply");
    if (button) button.disabled = true;
    if (action === "refresh-workspace" &&
        !window.confirm("Nolane Infinite is open but its Companion bridge is not active. Refresh that page now? Any unsaved text currently being edited on the page may be lost.")) {
      if (button) button.disabled = false;
      return;
    }
    try {
      const result = await chrome.runtime.sendMessage({
        type: "NOLANE_APPLY_COMPATIBILITY_ACTION",
        tabId: activeTab.id,
        action,
        confirmed: action === "refresh-workspace",
        keepSourceVisible: $("#keepSourceVisible").checked
      });
      if (!result?.ok) throw new Error(result?.error || "The compatibility action could not be applied.");
      status(result.message || "Recommended action applied.", "success");
      if (["open-workspace", "refresh-workspace", "focus-workspace"].includes(result.action)) {
        await refreshWorkspaceStatus();
      }
      if (result.action === "refresh-video") await diagnoseActiveTab();
    } catch (error) {
      status("Could not apply the recommendation: " + (error.message || error), "error");
      if (button) button.disabled = false;
    }
  }

  async function diagnoseActiveTab() {
    const button = $("#diagnoseButton");
    button.disabled = true;
    button.textContent = "Analyzing…";
    try {
      await refreshWorkspaceStatus();
      await refreshActiveTab();
      if (!activeTab || !Number.isInteger(activeTab.id)) throw new Error("No active website tab was found.");
      const result = await chrome.runtime.sendMessage({
        type: "NOLANE_DIAGNOSE_TAB",
        tabId: activeTab.id
      });
      if (!result?.ok) throw new Error(result?.error || "Could not analyze this website.");
      renderCompatibilityResult(result);
      status("Compatibility analysis completed locally for " + safeHost(activeTab.url) + ".", "success");
    } catch (error) {
      status("Compatibility analysis failed: " + (error.message || error), "error");
    } finally {
      button.disabled = false;
      button.textContent = "Analyze this website";
    }
  }

  async function copyDiagnostics() {
    const button = $("#diagnosticsButton");
    button.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "NOLANE_GET_DIAGNOSTICS" });
      if (!result?.ok) throw new Error(result?.error || "Could not collect compatibility diagnostics.");
      const report = {
        product: "Nolane Browser Companion",
        generatedAt: new Date().toISOString(),
        chromeVersion: (navigator.userAgent.match(/Chrome\/([0-9.]+)/) || [])[1] || "unknown",
        extensionVersion: result.extensionVersion || "unknown",
        sourceSite: safeHost(activeTab?.url || ""),
        activeTab: !!activeTab?.active,
        capturedTabs: result.capturedTabs || [],
        liveSessions: result.liveSessions || [],
        lastLiveDiagnostic: result.lastLiveDiagnostic || null,
        compatibilityProfiles: result.compatibilityProfiles || [],
        workspace: result.workspace || workspaceStatus
      };
      const output = JSON.stringify(report, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(output);
      } else {
        const helper = document.createElement("textarea");
        helper.value = output;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) throw new Error("Clipboard access is unavailable in this popup.");
      }
      status("Compatibility report copied. It excludes cookies and full page URLs.", "success");
    } catch (error) {
      status("Could not copy diagnostics: " + (error.message || error), "error");
    } finally {
      button.disabled = false;
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
      const workspace = await chrome.runtime.sendMessage({ type: "NOLANE_GET_WORKSPACE_STATUS" });
      if (!workspace?.ok) throw new Error(workspace?.error || "Could not check the Nolane workspace.");
      if (workspace.state === "missing") {
        await chrome.tabs.create({ url: WORKSPACE_URL });
        status("Opened Nolane Infinite. Wait for it to load, then reopen the Companion and import the selected tabs.", "success");
        return;
      }
      if (workspace.state !== "connected") {
        throw new Error(workspace.reason || "Reconnect the Nolane workspace before importing tabs.");
      }
      const result = await chrome.tabs.sendMessage(workspace.tabId, {
        type: "NOLANE_IMPORT_TABS",
        tabs: selected,
        browserSessionId: profile.profileId
      });
      if (!result || !result.ok) throw new Error("The workspace did not accept the selected tabs.");
      status("Imported " + result.count + " tab(s) into Nolane.", "success");
    } catch (error) {
      status("Could not reach Nolane: " + (error.message || "Refresh the workspace tab and try again."), "error");
    }
  }

  $("#liveButton").addEventListener("click", startLiveSurface);
  $("#stopLiveButton").addEventListener("click", stopLiveSurface);
  $("#diagnosticsButton").addEventListener("click", copyDiagnostics);
  $("#diagnoseButton").addEventListener("click", diagnoseActiveTab);
  $("#grantButton").addEventListener("click", grantPermission);
  $("#refreshButton").addEventListener("click", refreshTabs);
  $("#selectAllButton").addEventListener("click", () => {
    $("#tabList").querySelectorAll("input").forEach((input) => { input.checked = true; });
    updateImportButton();
  });
  $("#tabList").addEventListener("change", updateImportButton);
  $("#importButton").addEventListener("click", importSelected);
  $("#openWorkspaceButton").addEventListener("click", async () => {
    const button = $("#openWorkspaceButton");
    button.disabled = true;
    try {
      if (workspaceStatus.state === "refresh-required" &&
          !window.confirm("Reconnect the existing Nolane tab by refreshing it? Any unsaved text currently being edited on that page may be lost.")) return;
      const result = await chrome.runtime.sendMessage({
        type: "NOLANE_RECONNECT_WORKSPACE",
        confirmed: workspaceStatus.state === "refresh-required"
      });
      if (!result?.ok) throw new Error(result?.error || "Could not reconnect Nolane Infinite.");
      status(result.message || "Nolane workspace action completed.", "success");
      if (["refresh-workspace", "open-workspace"].includes(result.action)) workspaceStatus = { state: "checking", reason: result.message || "Opening Nolane Infinite…" };
      await refreshWorkspaceStatus();
    } catch (error) {
      status(error.message || String(error), "error");
    } finally {
      button.disabled = false;
      updateWorkspaceButton();
    }
  });
  refreshWorkspaceStatus().then(refreshActiveTab).catch((error) => status(error.message || String(error), "error"));
  checkPermission().catch((error) => status(error.message || String(error), "error"));
})();
