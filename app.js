(() => {
  "use strict";

  const DB_NAME = "nolane-infinite";
  const DB_VERSION = 1;
  const STORE_NAME = "workspace";
  const STORAGE_KEY = "nolane-infinite-workspace-v1";
  const MAX_NODES = 2000;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.2;
  const SAFE_FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";
  const COMPATIBILITY_FRAME_SANDBOX = SAFE_FRAME_SANDBOX + " allow-same-origin allow-storage-access-by-user-activation";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const canvas = $("#canvasArea");
  const world = $("#world");
  const grid = $("#canvasGrid");
  const addDialog = $("#addDialog");
  const addForm = $("#addForm");
  const toastRegion = $("#toastRegion");
  const fileInput = $("#fileInput");

  let db = null;
  let saveTimer = null;
  let selectedId = null;
  let searchResultIds = [];
  let searchResultIndex = -1;
  let activeTab = "website";
  let activeView = "canvas";
  let editingId = null;
  let noteColor = "lavender";
  let zCounter = 10;
  let panState = null;
  let dragState = null;
  let resizeState = null;
  let spacePressed = false;
  let nodes = [];
  let view = { x: 25, y: 0, scale: 0.88 };
  let spaces = [];
  let activeSpaceId = "personal";
  let nativeHostAvailable = false;
  let nativeMaxVisibleSurfaces = 2;
  let nativeWorkspaceIdsDirty = true;
  let nativeWorkspaceIdsCache = [];
  let nativeProfileUsageDirty = true;
  let nativeWorkspaceSnapshotProtocol = false;
  let nativeWorkspaceSnapshotRevision = 0;
  let nativeWorkspaceSnapshotPendingRevision = 0;
  let nativeWorkspaceSnapshotRetryTimer = 0;
  let nativeSyncFrame = 0;
  let nativeHostReadyNotified = false;
  let nativeBridgeSocket = null;
  let nativeBridgePermission = "unknown";
  let nativeBridgeReconnectTimer = 0;
  let nativeBridgeReconnectAttempts = 0;
  const nativeSurfaceStates = new Map();
  const spatialIndex = new window.NolaneSpatialIndex.SpatialIndex(640);
  const renderedNodeElements = new Map();
  let canvasRenderOrigin = { x: 0, y: 0 };
  const CANVAS_RENDER_ORIGIN_QUANTUM = 4096;
  const CANVAS_OVERSCAN_PX = 280;
  const MAX_NATIVE_SURFACE_CANDIDATES = 8;
  let canvasRenderFrame = 0;
  let minimapFrame = 0;
  let minimapGeometryDirty = true;
  let minimapGeometryCache = null;
  let canvasResizeObserver = null;
  let availableBrowserProfilesCache = null;
  let nativeProfileUsageCache = null;
  let nodeSearchTextCache = new WeakMap();

  const uid = () => {
    let candidate;
    do {
      candidate = "node-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    } while (nodes.some((node) => node.id === candidate) || spaces.some((space) => space.id === candidate));
    return candidate;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const MAX_WORLD_COORDINATE = 8_000_000;
  const normalizeCanvasCoordinate = (value, fallback = 0) =>
    window.NolaneSpatialIndex.normalizeWorldCoordinate(value, fallback, MAX_WORLD_COORDINATE);
  const normalizeCanvasView = (value) =>
    window.NolaneSpatialIndex.normalizeViewState(value, {
      defaultX: 25, defaultY: 0, defaultScale: 1,
      minScale: MIN_SCALE, maxScale: MAX_SCALE,
      maxWorldCoordinate: MAX_WORLD_COORDINATE
    });
  const escapeHTML = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const hostOf = (value) => {
    try { return new URL(value).hostname.replace(/^www\./, ""); } catch (_) { return value || ""; }
  };
  const initials = (value) => {
    const clean = String(value || "W").replace(/^www\./, "");
    return clean.slice(0, 1).toUpperCase();
  };

  function defaultNodes() {
    return [
      {
        id: "welcome-note", type: "note", title: "Start with a blank canvas", content: "Your web, arranged your way.\n\nAdd the websites you use, make notes, and move everything into a workspace that makes sense to you.\n\nThis space is private to this browser.", color: "lavender",
        x: 60, y: 165, w: 295, h: 276, z: 3, createdAt: new Date().toISOString()
      },
      {
        id: "github-shortcut", type: "website", title: "GitHub", url: "https://github.com", description: "Your repositories, pull requests and developer workspace.",
        x: 395, y: 160, w: 390, h: 315, z: 4, createdAt: new Date().toISOString()
      },
      {
        id: "ai-shortcut", type: "website", title: "ChatGPT", url: "https://chatgpt.com", description: "An AI space for thinking, writing and exploring ideas.",
        x: 825, y: 160, w: 390, h: 315, z: 5, createdAt: new Date().toISOString()
      },
      {
        id: "idea-note", type: "note", title: "A workspace that feels like yours", content: "Think beyond tabs.\n\nGroup tools by project. Keep research beside the source. Put notes next to the websites they belong to.\n\nThe canvas can grow in every direction.", color: "mint",
        x: 395, y: 510, w: 820, h: 205, z: 2, createdAt: new Date().toISOString()
      }
    ];
  }


  function defaultSpaces() {
    return [
      { id: "personal", name: "My workspace", nodes: defaultNodes(), view: { x: 25, y: 0, scale: 0.88 } },
      { id: "research", name: "Research lab", nodes: [], view: { x: 25, y: 0, scale: 1 } },
      { id: "projects", name: "Projects", nodes: [], view: { x: 25, y: 0, scale: 1 } }
    ];
  }

  function normalizeSpace(space, index, usedSpaceIds) {
    if (!space || typeof space !== "object" || Array.isArray(space)) return null;
    const id = window.NolaneSpatialIndex.claimUniqueId(space.id, usedSpaceIds, uid);
    const name = String(space.name || ("Space " + (index + 1))).trim().slice(0, 48) || ("Space " + (index + 1));
    const cleanNodes = normalizeNodeCollection(space.nodes);
    const rawView = space.view || {};
    const cleanView = normalizeCanvasView(rawView);
    return { id, name, nodes: cleanNodes, view: cleanView };
  }

  function normalizeSpaceCollection(rawSpaces) {
    if (!Array.isArray(rawSpaces)) return [];
    const usedSpaceIds = new Set();
    const normalized = [];
    for (let index = 0; index < rawSpaces.length && normalized.length < 12; index += 1) {
      const space = normalizeSpace(rawSpaces[index], index, usedSpaceIds);
      if (space) normalized.push(space);
    }
    return normalized;
  }

  function activeSpace() {
    return spaces.find((space) => space.id === activeSpaceId) || spaces[0] || null;
  }

  function syncActiveSpace() {
    const current = activeSpace();
    if (!current) return;
    current.nodes = window.NolaneWorkspaceStorage.sanitizeNodes(nodes);
    current.view = { x: view.x, y: view.y, scale: view.scale };
  }


  function switchSpace(id) {
    if (id === activeSpaceId) return;
    syncActiveSpace();
    const next = spaces.find((space) => space.id === id);
    if (!next) return;
    activeSpaceId = next.id;
    nodes = next.nodes.map((node) => ({ ...node }));
    view = { ...next.view };
    selectedId = null;
    activeView = "canvas";
    $("#searchInput").value = "";
    renderNodes();
    applyView();
    updateCounts();
    scheduleSave();
    $("#sidebar").classList.remove("open");
    toast("Switched to " + next.name + ".");
  }

  function createSpace() {
    if (spaces.length >= 12) return toast("You can create up to 12 local spaces.", "error");
    const name = window.prompt("Name your new space", "New space");
    if (name === null) return;
    const cleanName = name.trim().slice(0, 48);
    if (!cleanName) return toast("Give your space a name first.", "error");
    if (spaces.some((space) => space.name.toLowerCase() === cleanName.toLowerCase())) return toast("A space with that name already exists.", "error");
    syncActiveSpace();
    const next = { id: uid(), name: cleanName, nodes: [], view: { x: 25, y: 0, scale: 1 } };
    spaces.push(next);
    renderSpaces();
    switchSpace(next.id);
  }

  function renameSpace(id) {
    const space = spaces.find((item) => item.id === id);
    if (!space) return;
    const name = window.prompt("Rename workspace", space.name);
    if (name === null) return;
    const cleanName = name.trim().slice(0, 48);
    if (!cleanName) return toast("Workspace name cannot be empty.", "error");
    if (spaces.some((item) => item.id !== id && item.name.toLowerCase() === cleanName.toLowerCase())) return toast("A space with that name already exists.", "error");
    space.name = cleanName;
    renderSpaces();
    updateViewFilter();
    scheduleSave();
    toast("Workspace renamed.");
  }

  function deleteSpace(id) {
    if (spaces.length <= 1) return toast("Keep at least one workspace.", "error");
    const space = spaces.find((item) => item.id === id);
    if (!space) return;
    if (!window.confirm('Delete "' + space.name + '" and all of its local items? This cannot be undone.')) return;
    syncActiveSpace();
    invalidateNativeProfileUsageCache();
    spaces = spaces.filter((item) => item.id !== id);
    if (activeSpaceId === id) {
      activeSpaceId = spaces[0].id;
      nodes = spaces[0].nodes.map((node) => ({ ...node }));
      view = { ...spaces[0].view };
      selectedId = null;
      activeView = "canvas";
      $("#searchInput").value = "";
      renderNodes();
      applyView();
    }
    renderSpaces();
    scheduleSave();
    toast("Workspace deleted from this device.");
  }

  function renderSpaces() {
    const list = $("#spaceList");
    if (!list) return;
    list.replaceChildren();
    const colors = ["violet", "cyan", "amber", "green", "rose", "blue"];
    spaces.forEach((space, index) => {
      const row = document.createElement("div");
      row.className = "space-row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "space-item" + (space.id === activeSpaceId ? " selected" : "");
      button.title = "Double-click to rename · Right-click to delete";
      button.innerHTML = '<span class="space-dot ' + colors[index % colors.length] + '"></span><span class="space-name">' + escapeHTML(space.name) + '</span><span class="space-mini-count">' + space.nodes.length + '</span>';
      button.addEventListener("click", () => switchSpace(space.id));
      button.addEventListener("dblclick", (event) => { event.preventDefault(); renameSpace(space.id); });
      button.addEventListener("contextmenu", (event) => { event.preventDefault(); deleteSpace(space.id); });
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "space-edit";
      rename.title = "Rename " + space.name;
      rename.setAttribute("aria-label", "Rename " + space.name);
      rename.innerHTML = '<svg class="icon"><use href="#i-more"/></svg>';
      rename.addEventListener("click", () => renameSpace(space.id));
      row.append(button, rename);
      list.appendChild(row);
    });
    const current = activeSpace();
    if (current) {
      $(".workspace-meta strong").textContent = current.name;
      $(".breadcrumb > span").textContent = current.name;
    }
  }

  function normalizeUrl(raw) {
    let value = String(raw || "").trim();
    if (!value) throw new Error("Enter a website address first.");
    if (value.length > 4096) throw new Error("Website addresses must be 4,096 characters or fewer.");
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
    let parsed;
    try { parsed = new URL(value); } catch (_) { throw new Error("That address does not look valid."); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http and https website addresses are supported.");
    }
    if (parsed.username || parsed.password) throw new Error("Remove username or password information from the address.");
    if (!parsed.hostname || (parsed.hostname.indexOf(".") === -1 && parsed.hostname !== "localhost" && !parsed.hostname.startsWith("["))) {
      throw new Error("Enter a full website address, such as example.com.");
    }
    if (parsed.href.length > 4096) throw new Error("Normalized website addresses must be 4,096 characters or fewer.");
    return parsed.href;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB is unavailable."));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => { db = request.result; resolve(db); };
      request.onerror = () => reject(request.error || new Error("Could not open local storage."));
    });
  }

  function idbRead() {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database is not ready."));
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get("main");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function idbWrite(value) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database is not ready."));
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, "main");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Save was cancelled."));
    });
  }

  function setSaveState(kind, label) {
    const indicator = $("#saveIndicator");
    indicator.classList.remove("saving", "error");
    if (kind === "saving") indicator.classList.add("saving");
    if (kind === "error") indicator.classList.add("error");
    indicator.lastChild.textContent = " " + label;
    $("#storageStatus").textContent = kind === "error" ? "Local save unavailable" : "Saved on this device";
  }

  async function loadWorkspace() {
    let saved = null;
    try {
      await openDatabase();
      saved = await idbRead();
      if (navigator.storage && typeof navigator.storage.persist === "function") {
        navigator.storage.persist().catch(() => false);
      }
    } catch (_) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        saved = raw ? JSON.parse(raw) : null;
      } catch (_) { saved = null; }
    }

    if (saved && Array.isArray(saved.spaces) && saved.spaces.length) {
      spaces = normalizeSpaceCollection(saved.spaces);
      activeSpaceId = spaces.some((space) => space.id === saved.activeSpaceId) ? saved.activeSpaceId : spaces[0].id;
      const current = activeSpace();
      nodes = current.nodes.map((node) => ({ ...node }));
      view = { ...current.view };
      toast("Your local workspaces were restored.");
    } else if (saved && Array.isArray(saved.nodes)) {
      nodes = normalizeNodeCollection(saved.nodes);
      if (saved.view && typeof saved.view === "object" && !Array.isArray(saved.view)) {
        view = normalizeCanvasView(saved.view);
      }
      spaces = [
        { id: "personal", name: "My workspace", nodes: nodes.map((node) => ({ ...node })), view: { ...view } },
        { id: "research", name: "Research lab", nodes: [], view: { x: 25, y: 0, scale: 1 } },
        { id: "projects", name: "Projects", nodes: [], view: { x: 25, y: 0, scale: 1 } }
      ];
      activeSpaceId = "personal";
      toast("Your previous workspace was upgraded.");
    } else {
      spaces = defaultSpaces();
      activeSpaceId = "personal";
      const current = activeSpace();
      nodes = current.nodes.map((node) => ({ ...node }));
      view = { ...current.view };
      toast("Your private workspace is ready.");
    }

    if (!spaces.length) spaces = defaultSpaces();
    if (!activeSpace()) activeSpaceId = spaces[0].id;
    zCounter = Math.max(10, ...nodes.map((node) => Number(node.z) || 0)) + 1;
    renderSpaces();
    renderNodes();
    applyView();
    updateCounts();
    updateMinimap();
    setSaveState("saved", "All changes saved");
    scheduleSave(600);
  }

  function normalizeNodeCollection(rawNodes) {
    if (!Array.isArray(rawNodes)) return [];
    const usedIds = new Set();
    const normalized = [];
    for (const candidate of rawNodes) {
      const node = validateNode(candidate, usedIds);
      if (!node) continue;
      normalized.push(node);
      if (normalized.length >= MAX_NODES) break;
    }
    return normalized;
  }

  function validateNode(node, usedIds) {
    if (!node || typeof node !== "object" || Array.isArray(node) || !["website", "note"].includes(node.type)) return null;
    const clean = {
      id: "",
      type: node.type,
      title: String(node.title || (node.type === "note" ? "Untitled note" : "Website")).slice(0, 120),
      x: normalizeCanvasCoordinate(node.x, 0),
      y: normalizeCanvasCoordinate(node.y, 0),
      w: clamp(Number(node.w) || 360, 230, 1800),
      h: clamp(Number(node.h) || 280, 150, 1200),
      z: clamp(Number(node.z) || 1, 1, 100000),
      createdAt: node.createdAt || new Date().toISOString()
    };
    if (node.type === "website") {
      try { clean.url = normalizeUrl(node.url); } catch (_) { return null; }
      clean.description = String(node.description || "A website in your workspace.").slice(0, 240);
      clean.embedMode = node.embedMode === "compat" ? "compat" : "safe";
      clean.privateMode = node.privateMode === true;
      const browserProfile = window.NolaneNativeBridge?.normalizeProfileName(node.browserProfile);
      if (browserProfile) clean.browserProfile = browserProfile;
    } else {
      clean.content = String(node.content || "").slice(0, 12000);
      clean.color = ["lavender", "mint", "peach", "blue"].includes(node.color) ? node.color : "lavender";
    }
    // Claim the ID only after the record has passed validation, so an invalid
    // earlier import record cannot force a later valid card to receive a new ID.
    clean.id = window.NolaneSpatialIndex.claimUniqueId(node.id, usedIds || new Set(), uid);
    return clean;
  }

  function workspaceSnapshot() {
    syncActiveSpace();
    return {
      schema: "nolane-infinite-workspace",
      version: 2,
      exportedAt: new Date().toISOString(),
      activeSpaceId,
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        view: { ...space.view },
        nodes: window.NolaneWorkspaceStorage.sanitizeNodes(space.nodes)
      }))
    };
  }

  function scheduleSave(delay) {
    // Keep the active space's sanitized model current when data changes, not on every camera frame.
    syncActiveSpace();
    refreshNativeWorkspaceIdsSnapshot();
    invalidateWorkspaceDerivedCaches();
    clearTimeout(saveTimer);
    setSaveState("saving", "Saving locally…");
    saveTimer = setTimeout(saveWorkspace, typeof delay === "number" ? delay : 450);
  }

  async function saveWorkspace() {
    clearTimeout(saveTimer);
    const snapshot = workspaceSnapshot();
    try {
      if (db) await idbWrite(snapshot);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setSaveState("saved", "All changes saved");
    } catch (error) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        setSaveState("saved", "Saved locally");
      } catch (_) {
        setSaveState("error", "Could not save");
        console.error("Nolane workspace save failed:", error);
      }
    }
  }

  function applyView() {
    updateCanvasRenderOrigin();
    applyCanvasWorldTransform();
    grid.style.backgroundPosition = (view.x % (24 * view.scale)) + "px " + (view.y % (24 * view.scale)) + "px";
    $("#zoomValue").textContent = Math.round(view.scale * 100) + "%";
    scheduleCanvasVirtualization();
    updateMinimap();
    scheduleNativeSurfaceSync();
  }

  function canUseNativeSurface(node) {
    return !!(nativeHostAvailable && node && node.type === "website");
  }

  function sendNativePanelCommand(panel) {
    if (!sendNativeBridgeMessage({ type: "nolane.panel.command", protocol: 2, panel }))
      toast("Windows background bridge is not connected.", "error");
  }

  function sendNativeBridgeMessage(message) {
    if (!nativeBridgeSocket || nativeBridgeSocket.readyState !== WebSocket.OPEN) return false;
    try { nativeBridgeSocket.send(JSON.stringify(message)); return true; }
    catch (_) { return false; }
  }

  function postNativeSurfaceCommand(surfaceId, action) {
    const command = window.NolaneNativeBridge?.createCommand(surfaceId, action);
    if (!command || !sendNativeBridgeMessage(command)) toast("Windows background bridge is not connected.", "error");
  }

  function navigateNativeSurface(surfaceId, rawUrl) {
    let url;
    try { url = normalizeUrl(rawUrl); }
    catch (error) {
      toast(error.message || "Enter a valid HTTP or HTTPS address.", "error");
      return;
    }
    const command = window.NolaneNativeBridge?.createNavigationCommand(surfaceId, url);
    if (!command || !sendNativeBridgeMessage(command)) {
      toast("Windows background bridge is not connected or this address is not supported.", "error");
      return;
    }
    toast("Navigating to " + hostOf(url) + ".");
  }

  function currentCanvasWorldBounds(overscanPixels) {
    const rect = canvas.getBoundingClientRect();
    const overscan = Math.max(0, Number(overscanPixels) || 0) / view.scale;
    return { x: -view.x / view.scale - overscan, y: -view.y / view.scale - overscan,
      w: rect.width / view.scale + overscan * 2, h: rect.height / view.scale + overscan * 2 };
  }

  function applyCanvasWorldTransform() {
    const transform = window.NolaneSpatialIndex.createRebasedTransform(view, canvasRenderOrigin);
    world.style.transform = "translate(" + transform.x + "px," + transform.y + "px) scale(" + transform.scale + ")";
  }

  function positionCanvasNodeElement(element, node) {
    const local = window.NolaneSpatialIndex.rebasePoint(node, canvasRenderOrigin);
    element.style.left = local.x + "px";
    element.style.top = local.y + "px";
  }

  function updateCanvasRenderOrigin() {
    const rect = canvas.getBoundingClientRect();
    const next = window.NolaneSpatialIndex.computeRenderOrigin(
      view,
      { width: rect.width, height: rect.height },
      CANVAS_RENDER_ORIGIN_QUANTUM
    );
    if (next.x === canvasRenderOrigin.x && next.y === canvasRenderOrigin.y) return false;
    canvasRenderOrigin = next;
    for (const [id, element] of renderedNodeElements) {
      const node = spatialIndex.get(id);
      if (node) positionCanvasNodeElement(element, node);
    }
    applyCanvasWorldTransform();
    return true;
  }

  function cachedNodeSearchText(node) {
    let searchText = nodeSearchTextCache.get(node);
    if (searchText === undefined) {
      searchText = [node.title, node.url || "", node.content || "", node.description || ""]
        .join(" ").toLowerCase();
      nodeSearchTextCache.set(node, searchText);
    }
    return searchText;
  }

  function matchesNodeFilters(node, query) {
    if (!node) return false;
    const typeMatch = activeView === "canvas" ||
      (activeView === "websites" && node.type === "website") ||
      (activeView === "notes" && node.type === "note");
    if (!typeMatch) return false;
    return !query || cachedNodeSearchText(node).includes(query);
  }

  function scheduleCanvasVirtualization() {
    if (canvasRenderFrame) return;
    canvasRenderFrame = requestAnimationFrame(() => {
      canvasRenderFrame = 0;
      syncCanvasNodeElements(false);
    });
  }

  function syncCanvasNodeElements(forceRefresh) {
    updateCanvasRenderOrigin();
    const query = $("#searchInput").value.trim().toLowerCase();
    const wanted = new Map();
    for (const node of spatialIndex.query(currentCanvasWorldBounds(CANVAS_OVERSCAN_PX))) {
      if (matchesNodeFilters(node, query)) wanted.set(node.id, node);
    }
    if (selectedId) {
      const selectedNode = spatialIndex.get(selectedId);
      if (selectedNode) wanted.set(selectedNode.id, selectedNode);
    }
    for (const [id, element] of renderedNodeElements) {
      if (wanted.has(id)) continue;
      element.remove();
      renderedNodeElements.delete(id);
    }
    for (const node of wanted.values()) {
      let element = renderedNodeElements.get(node.id);
      if (!element || forceRefresh) {
        const replacement = createNodeElement(node);
        if (element) element.replaceWith(replacement);
        else world.appendChild(replacement);
        element = replacement;
        renderedNodeElements.set(node.id, element);
      } else {
        positionCanvasNodeElement(element, node);
        element.style.width = node.w + "px";
        element.style.height = node.h + "px";
        element.style.zIndex = node.z || 1;
        element.classList.toggle("selected", node.id === selectedId);
      }
      element.classList.toggle("hidden-by-search", !matchesNodeFilters(node, query));
    }
  }

  function clearNativeWorkspaceSnapshotRetry() {
    if (!nativeWorkspaceSnapshotRetryTimer) return;
    window.clearTimeout(nativeWorkspaceSnapshotRetryTimer);
    nativeWorkspaceSnapshotRetryTimer = 0;
  }

  function scheduleNativeWorkspaceSnapshotRetry(revision) {
    clearNativeWorkspaceSnapshotRetry();
    nativeWorkspaceSnapshotRetryTimer = window.setTimeout(() => {
      nativeWorkspaceSnapshotRetryTimer = 0;
      if (nativeWorkspaceSnapshotPendingRevision !== revision) return;
      // WebSocket.send() only confirms local queueing, not that the Windows
      // receiver assembled and committed every chunk. Retry with a new revision
      // so an incomplete receiver transaction is always superseded.
      nativeWorkspaceIdsDirty = true;
      nativeProfileUsageDirty = true;
      if (nativeBridgeSocket?.readyState === WebSocket.OPEN) scheduleNativeSurfaceSync();
    }, 5000);
  }

  function sendNativeWorkspaceSnapshot() {
    if (!nativeWorkspaceSnapshotProtocol ||
        (!nativeWorkspaceIdsDirty && !nativeProfileUsageDirty)) return true;
    const revision = nativeWorkspaceSnapshotRevision + 1;
    const profiles = cachedNativeProfileUsage().map((item) => ({ name: item.name, count: item.count }));
    const messages = window.NolaneNativeBridge?.createWorkspaceSnapshotMessages(
      revision, nativeWorkspaceIdsCache, profiles
    );
    if (!messages) return false;

    // Consume the revision before sending. If a socket failure interrupts this
    // transfer, the next attempt uses a newer revision and supersedes the partial one.
    clearNativeWorkspaceSnapshotRetry();
    nativeWorkspaceSnapshotRevision = revision;
    nativeWorkspaceSnapshotPendingRevision = revision;
    for (const message of messages) {
      if (!sendNativeBridgeMessage(message)) {
        nativeWorkspaceSnapshotPendingRevision = 0;
        return false;
      }
    }
    nativeWorkspaceIdsDirty = false;
    nativeProfileUsageDirty = false;
    scheduleNativeWorkspaceSnapshotRetry(revision);
    return true;
  }

  function scheduleNativeSurfaceSync() {
    if (!nativeHostAvailable || !nativeBridgeSocket || nativeBridgeSocket.readyState !== WebSocket.OPEN || nativeSyncFrame) return;
    nativeSyncFrame = requestAnimationFrame(() => {
      nativeSyncFrame = 0;
      const area = canvas.getBoundingClientRect();
      const uiBlocked = !!document.querySelector("dialog[open], #sidebar.open");
      const scale = view.scale;
      const query = $("#searchInput").value.trim().toLowerCase();
      const items = [];

      // Send a small z-ranked candidate pool from the real viewport. The host still
      // activates only its adaptive renderer budget; extra candidates are fallbacks
      // when a higher card cannot initialize or must be retained for an active download.
      if (!uiBlocked && document.visibilityState === "visible") {
        const candidates = window.NolaneSpatialIndex.sortByZIndex(
          spatialIndex.query(currentCanvasWorldBounds(0))
            .filter((node) => canUseNativeSurface(node) && matchesNodeFilters(node, query))
        );

        const candidateLimit = Math.min(MAX_NATIVE_SURFACE_CANDIDATES, nativeMaxVisibleSurfaces + 4);
        for (const node of candidates) {
          const rect = {
            left: area.left + view.x + (node.x + 1) * scale,
            top: area.top + view.y + (node.y + 40) * scale,
            width: Math.max(0, node.w - 2) * scale,
            height: Math.max(0, node.h - 41) * scale
          };
          const right = rect.left + rect.width, bottom = rect.top + rect.height;
          const clipLeft = Math.max(rect.left, area.left), clipTop = Math.max(rect.top, area.top);
          const clipRight = Math.min(right, area.right), clipBottom = Math.min(bottom, area.bottom);
          const clipWidth = Math.max(0, clipRight - clipLeft), clipHeight = Math.max(0, clipBottom - clipTop);
          if (rect.width < 80 || rect.height < 60 || clipWidth < 80 || clipHeight < 60) continue;

          items.push({
            id: node.id, url: node.privateMode && node.transientUrl ? node.transientUrl : node.url,
            title: node.title, privateMode: node.privateMode === true, profileName: node.browserProfile || "",
            x: Math.round(rect.left * 100) / 100, y: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100,
            clipX: Math.round((clipLeft - rect.left) * 100) / 100,
            clipY: Math.round((clipTop - rect.top) * 100) / 100,
            clipWidth: Math.round(clipWidth * 100) / 100, clipHeight: Math.round(clipHeight * 100) / 100,
            zIndex: Number(node.z) || 1, visible: true
          });
          if (items.length >= candidateLimit) break;
        }
      }

      const outerWidth = Number(window.outerWidth) || window.innerWidth;
      const outerHeight = Number(window.outerHeight) || window.innerHeight;
      const viewport = {
        screenLeft: (Number(window.screenX) || 0) + Math.max(0, (outerWidth - window.innerWidth) / 2),
        screenTop: (Number(window.screenY) || 0) + Math.max(0, outerHeight - window.innerHeight - 8),
        width: window.innerWidth, height: window.innerHeight, deviceScale: window.devicePixelRatio || 1
      };
      if (nativeWorkspaceSnapshotProtocol) {
        // Metadata is chunked and sent only when dirty; camera frames stay compact.
        if (!sendNativeWorkspaceSnapshot() && nativeBridgeSocket?.readyState === WebSocket.OPEN) {
          window.setTimeout(scheduleNativeSurfaceSync, 250);
        }
      }
      const message = {
        type: "nolane.surfaces.sync", protocol: 2, viewport,
        workspaceVisible: document.visibilityState === "visible",
        items
      };
      // Older installed hosts do not advertise snapshot support. Keep the original
      // protocol-v2 inline fields until those hosts are upgraded.
      if (!nativeWorkspaceSnapshotProtocol) {
        if (nativeProfileUsageDirty) {
          message.profileUsage = cachedNativeProfileUsage().map((item) => [item.name, item.count]);
        }
        if (nativeWorkspaceIdsDirty) message.workspaceIds = nativeWorkspaceIdsCache;
      }
      if (sendNativeBridgeMessage(message) && !nativeWorkspaceSnapshotProtocol) {
        if (nativeWorkspaceIdsDirty) nativeWorkspaceIdsDirty = false;
        if (nativeProfileUsageDirty) nativeProfileUsageDirty = false;
      }
    });
  }

  function handleNativeHostMessage(event) {
    const message = event?.data ?? event;
    if (!message || typeof message !== "object") return;
    if (message.type === "nolane.native.ready") {
      clearNativeWorkspaceSnapshotRetry();
      nativeWorkspaceSnapshotPendingRevision = 0;
      nativeHostAvailable = true;
      nativeWorkspaceSnapshotProtocol = message.workspaceSnapshotProtocol === 1;
      nativeBridgePermission = "granted";
      nativeBridgeReconnectAttempts = 0;
      const reportedBudget = Number(message.maxVisibleSurfaces);
      nativeMaxVisibleSurfaces = Number.isInteger(reportedBudget) ? clamp(reportedBudget, 1, 8) : 2;
      refreshNativeWorkspaceIdsSnapshot();
      nativeWorkspaceIdsDirty = true;
      nativeProfileUsageDirty = true;
      updateBridgeStatus();
      if (!nativeHostReadyNotified) {
        nativeHostReadyNotified = true;
        toast("Nolane Windows Bridge connected. Website cards now use native browser surfaces.");
      }
      renderNodes();
      return;
    }
    if (message.type === "nolane.workspace.snapshot.ack") {
      if (window.NolaneNativeBridge?.isWorkspaceSnapshotAck(message, nativeWorkspaceSnapshotPendingRevision)) {
        nativeWorkspaceSnapshotPendingRevision = 0;
        clearNativeWorkspaceSnapshotRetry();
      }
      return;
    }
    if (message.type === "nolane.native.surface") {
      const state = window.NolaneNativeBridge?.normalizeSurfaceState(message);
      if (!state) return;
      nativeSurfaceStates.set(state.id, state);
      const node = nodes.find((item) => item.id === state.id);
      if (node && state.isPrivateMode !== null && node.privateMode !== state.isPrivateMode) {
        node.privateMode = state.isPrivateMode;
        if (!state.isPrivateMode) delete node.transientUrl;
        scheduleSave();
      }
      if (node && state.profileName !== null) {
        const actualProfile = state.profileName || "";
        const savedProfile = node.browserProfile || "";
        if (savedProfile !== actualProfile) {
          if (actualProfile) node.browserProfile = actualProfile;
          else delete node.browserProfile;
          invalidateNativeProfileUsageCache();
          scheduleSave();
          scheduleNativeSurfaceSync();
        }
        const profileSelect = $('.node[data-id="' + CSS.escape(state.id) + '"] .native-profile-select', world);
        if (profileSelect) profileSelect.value = actualProfile;
      }
      if (node && state.url) {
        try {
          const currentUrl = normalizeUrl(state.url);
          if (node.privateMode) {
            if (node.transientUrl !== currentUrl) {
              node.transientUrl = currentUrl;
              scheduleNativeSurfaceSync();
            }
          } else if (node.url !== currentUrl) {
            node.url = currentUrl;
            scheduleSave();
            scheduleNativeSurfaceSync();
          }
          const address = $('.node[data-id="' + CSS.escape(state.id) + '"] .native-address-input', world);
          if (address && document.activeElement !== address) address.value = currentUrl;
        } catch (_) {}
      }
      const card = $('.node[data-id="' + CSS.escape(state.id) + '"]', world);
      if (!card) return;
      let status = card.querySelector(".native-surface-status");
      if (!status) {
        status = document.createElement("span");
        status.className = "native-surface-status";
        card.querySelector(".node-title-wrap")?.appendChild(status);
      }
      const states = { ready: "NATIVE WEB", loading: "LOADING WEB", suspended: "PAUSED", limit: "LIMIT", error: "WEB ERROR" };
      status.dataset.state = state.state;
      status.textContent = states[state.state] || "NATIVE WEB";
      status.title = state.detail || "Native WebView2 browser surface";

      let privateBadge = card.querySelector(".native-private-status");
      if (state.isPrivateMode === true) {
        if (!privateBadge) {
          privateBadge = document.createElement("span");
          privateBadge.className = "native-private-status";
          privateBadge.setAttribute("role", "status");
          card.querySelector(".node-title-wrap")?.appendChild(privateBadge);
        }
        privateBadge.textContent = "PRIVATE";
        privateBadge.title = "This card is using a temporary WebView2 InPrivate session. Its visited addresses are not saved by Nolane.";
      } else if (state.isPrivateMode === false) {
        privateBadge?.remove();
      }

      const back = card.querySelector('[data-action="native-back"]');
      const forward = card.querySelector('[data-action="native-forward"]');
      const mute = card.querySelector('[data-action="native-mute"]');
      if (back) back.disabled = !state.canGoBack;
      if (forward) forward.disabled = !state.canGoForward;
      if (mute) {
        mute.title = state.isMuted ? "Unmute this website" : "Mute this website";
        mute.setAttribute("aria-label", mute.title);
        mute.innerHTML = '<svg class="icon"><use href="#' + (state.isMuted ? "i-volume-x" : "i-volume-2") + '"/></svg>';
        mute.dataset.muted = state.isMuted ? "true" : "false";
        mute.dataset.playing = state.isPlayingAudio ? "true" : "false";
      }
      const profileSelect = card.querySelector(".native-profile-select");
      if (profileSelect && state.profileName !== null) profileSelect.value = state.profileName;

      const privateButton = card.querySelector('[data-action="native-private"]');
      if (privateButton) {
        privateButton.dataset.private = state.isPrivateMode ? "true" : "false";
        privateButton.setAttribute("aria-pressed", state.isPrivateMode ? "true" : "false");
        privateButton.title = state.isPrivateMode ? "Switch back to your regular browser session" : "Open a temporary private session";
        privateButton.setAttribute("aria-label", state.isPrivateMode ? "Switch back to regular session" : "Open private session");
      }
      const bookmark = card.querySelector('[data-action="native-bookmark"]');
      if (bookmark) {
        bookmark.disabled = state.isPrivateMode === true;
        bookmark.dataset.bookmarked = state.isBookmarked ? "true" : "false";
        bookmark.title = state.isPrivateMode ? "Bookmarks are disabled in private mode" :
          (state.isBookmarked ? "Remove bookmark" : "Bookmark this page");
        bookmark.setAttribute("aria-label", bookmark.title);
      }
      if (state.state === "limit") toast("This device's memory budget allows " + nativeMaxVisibleSurfaces + " visible native websites at once. Bring another card forward or hide one.", "error");
    }
  }

  window.addEventListener("resize", scheduleNativeSurfaceSync, { passive: true });
  window.addEventListener("scroll", scheduleNativeSurfaceSync, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    sendNativeBridgeMessage({ type: "nolane.workspace.visibility", protocol: 2, visible: document.visibilityState === "visible" });
    scheduleNativeSurfaceSync();
    if (document.visibilityState === "visible" && !nativeHostAvailable) queueWindowsBridgeReconnect();
  });
  window.addEventListener("focus", () => {
    sendNativeBridgeMessage({ type: "nolane.workspace.visibility", protocol: 2, visible: true });
    scheduleNativeSurfaceSync();
    if (!nativeHostAvailable) queueWindowsBridgeReconnect();
  });
  window.addEventListener("blur", () => {
    sendNativeBridgeMessage({ type: "nolane.workspace.visibility", protocol: 2, visible: document.visibilityState === "visible" });
  });
  const nativeUiObserver = new MutationObserver(scheduleNativeSurfaceSync);
  document.querySelectorAll("dialog, #sidebar").forEach((element) => {
    nativeUiObserver.observe(element, { attributes: true, attributeFilter: ["open", "class"] });
  });
  window.addEventListener("pagehide", () => {
    try { nativeBridgeSocket?.close(1000, "Workspace page closed"); } catch (_) {}
  });

  function worldPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const anchorX = (px - view.x) / view.scale;
    const anchorY = (py - view.y) / view.scale;
    const next = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
    view = normalizeCanvasView({
      x: px - anchorX * next,
      y: py - anchorY * next,
      scale: next
    });
    applyView();
    scheduleSave();
  }

  function fitCanvas(sourceNodes) {
    const group = Array.isArray(sourceNodes) ? sourceNodes : nodes;
    if (!group.length) { view = { x: 30, y: 30, scale: 1 }; applyView(); return; }
    const minX = Math.min(...group.map((node) => node.x));
    const minY = Math.min(...group.map((node) => node.y));
    const maxX = Math.max(...group.map((node) => node.x + node.w));
    const maxY = Math.max(...group.map((node) => node.y + node.h));
    const rect = canvas.getBoundingClientRect();
    const pad = 100;
    const scale = clamp(Math.min((rect.width - pad * 2) / Math.max(1, maxX - minX), (rect.height - pad * 2) / Math.max(1, maxY - minY)), MIN_SCALE, 1.25);
    view = normalizeCanvasView({
      scale,
      x: (rect.width - (maxX - minX) * scale) / 2 - minX * scale,
      y: (rect.height - (maxY - minY) * scale) / 2 - minY * scale
    });
    applyView();
    scheduleSave();
  }

  function updateCounts() {
    $("#websiteCount").textContent = nodes.filter((node) => node.type === "website").length;
    $("#noteCount").textContent = nodes.filter((node) => node.type === "note").length;
  }

  function renderNodes() {
    invalidateWorkspaceDerivedCaches();
    invalidateNativeProfileUsageCache();
    refreshNativeWorkspaceIdsSnapshot();
    spatialIndex.rebuild(nodes);
    updateCanvasRenderOrigin();
    syncCanvasNodeElements(true);
    updateViewFilter();
    updateCounts();
    renderSpaces();
    updateMinimap(true);
    scheduleNativeSurfaceSync();
  }

  function invalidateWorkspaceDerivedCaches() {
    availableBrowserProfilesCache = null;
    nodeSearchTextCache = new WeakMap();
  }

  function invalidateNativeProfileUsageCache() {
    nativeProfileUsageCache = null;
    nativeProfileUsageDirty = true;
  }

  function availableBrowserProfiles() {
    if (availableBrowserProfilesCache) return availableBrowserProfilesCache;
    const profiles = new Map();
    ["Work", "Personal", "Research"].forEach((name) => profiles.set(name.toLowerCase(), name));
    const allNodes = [...nodes, ...spaces.flatMap((space) => Array.isArray(space.nodes) ? space.nodes : [])];
    for (const item of allNodes) {
      const name = window.NolaneNativeBridge?.normalizeProfileName(item?.browserProfile);
      if (name) profiles.set(name.toLowerCase(), name);
    }
    availableBrowserProfilesCache = [...profiles.values()].sort((a, b) => a.localeCompare(b));
    return availableBrowserProfilesCache;
  }

  function cachedNativeProfileUsage() {
    if (!nativeProfileUsageCache) {
      nativeProfileUsageCache = window.NolaneNativeBridge?.summarizeProfileUsage(spaces) || [];
    }
    return nativeProfileUsageCache;
  }

  function refreshNativeWorkspaceIdsSnapshot() {
    const next = nodes.filter(canUseNativeSurface).map((node) => node.id);
    if (next.length !== nativeWorkspaceIdsCache.length ||
        next.some((id, index) => id !== nativeWorkspaceIdsCache[index])) {
      nativeWorkspaceIdsCache = next;
      nativeWorkspaceIdsDirty = true;
    }
  }

  function createNodeElement(node) {
    const article = document.createElement("article");
    article.className = "node" + (node.id === selectedId ? " selected" : "");
    article.dataset.id = node.id;
    positionCanvasNodeElement(article, node);
    article.style.width = node.w + "px";
    article.style.height = node.h + "px";
    article.style.zIndex = node.z || 1;
    const header = document.createElement("div");
    header.className = "node-header";
    const nativeState = nativeSurfaceStates.get(node.id) || {};
    const nativeTools = canUseNativeSurface(node)
      ? '<span class="native-card-tools" aria-label="Native browser controls">' +
        '<button class="node-action native-node-action" data-action="native-back" title="Go back" aria-label="Go back"' + (nativeState.canGoBack ? "" : " disabled") + '><svg class="icon"><use href="#i-arrow-left"/></svg></button>' +
        '<button class="node-action native-node-action" data-action="native-forward" title="Go forward" aria-label="Go forward"' + (nativeState.canGoForward ? "" : " disabled") + '><svg class="icon"><use href="#i-arrow-right"/></svg></button>' +
        '<button class="node-action native-node-action" data-action="native-reload" title="Reload website" aria-label="Reload website"><svg class="icon"><use href="#i-refresh"/></svg></button>' +
        '<button class="node-action native-node-action" data-action="native-mute" title="' + (nativeState.isMuted ? "Unmute this website" : "Mute this website") + '" aria-label="' + (nativeState.isMuted ? "Unmute this website" : "Mute this website") + '"><svg class="icon"><use href="#' + (nativeState.isMuted ? "i-volume-x" : "i-volume-2") + '"/></svg></button>' +
        '<button class="node-action native-node-action" data-action="native-private" data-private="' + (node.privateMode ? "true" : "false") + '" aria-pressed="' + (node.privateMode ? "true" : "false") + '" title="' + (node.privateMode ? "Switch back to your regular browser session" : "Open a temporary private session") + '" aria-label="' + (node.privateMode ? "Switch back to regular session" : "Open private session") + '"><svg class="icon"><use href="#i-shield"/></svg></button>' +
        '<button class="node-action native-node-action" data-action="native-bookmark" data-bookmarked="' + (nativeState.isBookmarked ? "true" : "false") + '" title="' + (nativeState.isBookmarked ? "Remove bookmark" : "Bookmark this page") + '" aria-label="' + (nativeState.isBookmarked ? "Remove bookmark" : "Bookmark this page") + '"' + (node.privateMode ? " disabled" : "") + '><svg class="icon"><use href="#i-star"/></svg></button>' +
        '</span>'
      : "";
    header.innerHTML =
      '<span class="node-favicon">' + (node.type === "website" ? escapeHTML(initials(hostOf(node.url))) : '<svg class="icon"><use href="#i-sticky"/></svg>') + '</span>' +
      '<span class="node-title-wrap"><span class="node-title">' + escapeHTML(node.title) + '</span>' +
        (canUseNativeSurface(node)
          ? '<input class="native-address-input" type="text" aria-label="Website address" title="Type an address and press Enter" spellcheck="false" autocomplete="off" value="' + escapeHTML(node.privateMode && node.transientUrl ? node.transientUrl : node.url) + '">' +
            '<select class="native-profile-select" aria-label="Browser profile" title="Choose an isolated login profile">' +
              '<option value="">Default</option>' +
              availableBrowserProfiles().map((name) => '<option value="' + escapeHTML(name) + '"' + ((node.browserProfile || "").toLowerCase() === name.toLowerCase() ? " selected" : "") + '>' + escapeHTML(name) + '</option>').join("") +
              '<option value="__new__">+ New profile…</option>' +
            '</select>'
          : '<span class="node-subtitle">' + escapeHTML(node.type === "website" ? hostOf(node.url) : "Personal note") + '</span>') +
      '</span>' +
      '<span class="node-actions">' + nativeTools +
        (node.type === "website" ? '<button class="node-action" data-action="open" title="' + "Open in browser" + '"><svg class="icon"><use href="#i-external"/></svg></button>' : '<button class="node-action" data-action="edit" title="Edit note"><svg class="icon"><use href="#i-sticky"/></svg></button>') +
        '<button class="node-action" data-action="delete" title="Remove"><svg class="icon"><use href="#i-x"/></svg></button>' +
      '</span>';
    article.appendChild(header);
    if (nativeState.isPrivateMode === true) {
      const privateBadge = document.createElement("span");
      privateBadge.className = "native-private-status";
      privateBadge.setAttribute("role", "status");
      privateBadge.textContent = "PRIVATE";
      privateBadge.title = "This card is using a temporary WebView2 InPrivate session.";
      header.querySelector(".node-title-wrap")?.appendChild(privateBadge);
    }
    const profileSelect = header.querySelector(".native-profile-select");
    if (profileSelect) {
      profileSelect.addEventListener("pointerdown", (event) => event.stopPropagation());
      profileSelect.addEventListener("click", (event) => event.stopPropagation());
      profileSelect.addEventListener("change", () => {
        let selectedProfile = profileSelect.value;
        if (selectedProfile === "__new__") {
          const proposed = window.prompt("Create a browser profile name (up to 64 letters, numbers, spaces, _ or -).", "");
          if (proposed === null) {
            profileSelect.value = node.browserProfile || "";
            return;
          }
          selectedProfile = window.NolaneNativeBridge?.normalizeProfileName(proposed);
          if (!selectedProfile) {
            toast("Profile name is invalid. Use up to 64 letters, numbers, spaces, underscores or hyphens.", "error");
            profileSelect.value = node.browserProfile || "";
            return;
          }
        } else if (selectedProfile) {
          selectedProfile = window.NolaneNativeBridge?.normalizeProfileName(selectedProfile);
          if (!selectedProfile) {
            profileSelect.value = node.browserProfile || "";
            return toast("That browser profile name is not supported.", "error");
          }
        }
        const nextProfile = selectedProfile || "";
        if ((node.browserProfile || "") === nextProfile) {
          profileSelect.value = nextProfile;
          return;
        }
        if (nextProfile) node.browserProfile = nextProfile;
        else delete node.browserProfile;
        scheduleSave();
        renderNodes();
        toast(nextProfile
          ? "Switching this card to the " + nextProfile + " profile. Its cookies and site data are separate."
          : "Switching this card to the Default browser profile.");
      });
    }

    const nativeAddressInput = header.querySelector(".native-address-input");
    if (nativeAddressInput) {
      nativeAddressInput.addEventListener("pointerdown", (event) => event.stopPropagation());
      nativeAddressInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        navigateNativeSurface(node.id, nativeAddressInput.value);
        nativeAddressInput.blur();
      });
      nativeAddressInput.addEventListener("click", (event) => event.stopPropagation());
    }

    const body = document.createElement("div");
    body.className = "node-body";
    if (node.type === "website") {
      body.innerHTML =
        '<div class="web-preview">' +
          '<div class="preview-mark">' + escapeHTML(initials(hostOf(node.url))) + '</div>' +
          '<div class="preview-title">' + escapeHTML(node.title) + '</div>' +
          '<div class="preview-domain">' + escapeHTML(hostOf(node.url)) + '</div>' +
          '<p class="preview-description">' + escapeHTML(node.description || "Connect the Windows background bridge to open this website as a native browser surface.") + '</p>' +
          '<div class="preview-actions"><button class="mini-button" data-action="open"><svg class="icon"><use href="#i-external"/></svg> Open in browser</button></div>' +
          '<div class="embed-note">Native website rendering is provided by the Windows background bridge.</div>' +
        '</div>';
    } else {
      body.innerHTML =
        '<div class="note-node ' + escapeHTML(node.color || "lavender") + '">' +
          '<div class="note-kicker">PERSONAL NOTE</div>' +
          '<h3>' + escapeHTML(node.title) + '</h3>' +
          '<div class="note-content">' + escapeHTML(node.content || "An empty note. Add a thought to get started.") + '</div>' +
          '<div class="note-bottom"><span>Saved on this device</span><button class="note-edit" data-action="edit">Edit note</button></div>' +
        '</div>';
    }
    article.appendChild(body);
    const resize = document.createElement("div");
    resize.className = "resize-handle";
    resize.title = "Resize window";
    article.appendChild(resize);
    header.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id));
    resize.addEventListener("pointerdown", (event) => startNodeResize(event, node.id));
    article.addEventListener("pointerdown", () => selectNode(node.id));
    article.addEventListener("click", handleNodeAction);
    return article;
  }


  function updateViewFilter() {
    const query = $("#searchInput").value.trim().toLowerCase();
    searchResultIds = [];
    searchResultIndex = -1;
    let visibleCount = 0;
    for (const node of nodes) {
      if (!matchesNodeFilters(node, query)) continue;
      visibleCount += 1;
      if (query) searchResultIds.push(node.id);
    }
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const [id, element] of renderedNodeElements) {
      element.classList.toggle("hidden-by-search", !matchesNodeFilters(nodesById.get(id), query));
    }
    const titles = { canvas: "My workspace", websites: "Web surfaces", notes: "Notes" };
    $("#viewTitle").textContent = activeView === "canvas" ? (activeSpace()?.name || titles.canvas) : titles[activeView];
    $("#canvasHeading").textContent = activeView === "websites" ? "Your web, gathered." : activeView === "notes" ? "Thoughts, in context." : (activeSpace()?.name || "A space for everything.");
    $("#canvasSubheading").textContent = query
      ? (visibleCount ? visibleCount + " matching items · Press Enter to jump, Shift+Enter to go back." : "No items match this search.")
      : activeView === "websites" ? "Open, arrange and revisit the websites you use."
        : activeView === "notes" ? "Keep ideas close to the things they belong to."
          : "Bring your web tools together. Arrange them your way.";
    const empty = $("#emptyState");
    empty.hidden = visibleCount > 0;
    $("#emptyTitle").textContent = query ? "No matches yet." : activeView === "websites" ? "No websites here yet." : activeView === "notes" ? "No notes here yet." : "A fresh space.";
    $("#emptyDescription").textContent = query ? "Try a different search, or clear the search field." : "Start with a website, a note, or both. Your workspace grows with you.";
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
    scheduleCanvasVirtualization();
    scheduleNativeSurfaceSync();
  }

  function focusSearchResult(reverse) {
    if (!$("#searchInput").value.trim() || !searchResultIds.length) return;
    searchResultIndex = window.NolaneSpatialIndex.cycleIndex(
      searchResultIndex, searchResultIds.length, reverse
    );
    if (searchResultIndex < 0) return;
    const node = nodes.find((item) => item.id === searchResultIds[searchResultIndex]);
    if (!node) return;

    const rect = canvas.getBoundingClientRect();
    const scale = clamp(Math.max(view.scale, 0.6), MIN_SCALE, MAX_SCALE);
    view = normalizeCanvasView({
      scale,
      x: rect.width / 2 - (node.x + node.w / 2) * scale,
      y: rect.height / 2 - (node.y + node.h / 2) * scale
    });
    selectNode(node.id);
    applyView();
    toast("Match " + (searchResultIndex + 1) + " of " + searchResultIds.length + ": " + node.title);
  }

  function selectNode(id) {
    selectedId = id;
    $$(".node", world).forEach((element) => element.classList.toggle("selected", element.dataset.id === id));
    const node = nodes.find((item) => item.id === id);
    if (node) {
      node.z = ++zCounter;
      const element = $('.node[data-id="' + CSS.escape(id) + '"]', world);
      if (element) element.style.zIndex = node.z;
      scheduleSave();
      scheduleCanvasVirtualization();
      scheduleNativeSurfaceSync();
    }
  }

  function handleNodeAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    event.stopPropagation();
    const article = event.currentTarget;
    const node = nodes.find((item) => item.id === article.dataset.id);
    if (!node) return;
    const action = button.dataset.action;
    if (action === "native-back") postNativeSurfaceCommand(node.id, "back");
    if (action === "native-forward") postNativeSurfaceCommand(node.id, "forward");
    if (action === "native-reload") postNativeSurfaceCommand(node.id, "reload");
    if (action === "native-mute") postNativeSurfaceCommand(node.id, "toggle-mute");
    if (action === "native-private") {
      node.privateMode = !node.privateMode;
      if (!node.privateMode) delete node.transientUrl;
      scheduleSave();
      scheduleNativeSurfaceSync();
      toast(node.privateMode
        ? "Starting a temporary private session. Its visited URLs, history and download metadata will not be saved."
        : "Returning to your regular browser profile.");
    }
    if (action === "native-bookmark") postNativeSurfaceCommand(node.id, "toggle-bookmark");
    if (action === "open" && node.type === "website") openWebsite(node);
    if (action === "open-url" && node.type === "website") openWebsiteUrl(node);
    if (action === "delete") deleteNode(node.id);
    if (action === "edit") editNote(node);
    if (action === "embed" && node.type === "website") activateEmbed(node, article, node.embedMode || "safe");
    if (action === "compatibility" && node.type === "website") setEmbedMode(node, article, "compat");
    if (action === "safe-mode" && node.type === "website") setEmbedMode(node, article, "safe");
    if (action === "reload") {
      const frame = $("iframe", article);
      if (frame) { frame.src = node.url; toast("Refreshing " + node.title + "."); }
    }
    if (action === "collapse") {
      node.collapsed = !node.collapsed;
      article.classList.toggle("collapsed", !!node.collapsed);
      toast(node.collapsed ? "Surface minimized." : "Surface restored.");
    }
  }

  function setEmbedMode(node, article, mode) {
    if (mode === "compat") {
      const accepted = window.confirm(
        "Enable Compatibility Preview for " + hostOf(node.url) + "?\n\n" +
        "This allows the site to use its normal origin and browser storage inside the frame. " +
        "Only enable this for a website you trust. A site that redirects to this workspace's own origin could weaken the sandbox boundary. " +
        "The website may still refuse iframe embedding. Continue?"
      );
      if (!accepted) return;
    }
    node.embedMode = mode === "compat" ? "compat" : "safe";
    activateEmbed(node, article, node.embedMode);
    scheduleSave();
  }

  function activateEmbed(node, article, mode) {
    if (new URL(node.url).origin === location.origin) return toast("For security, same-origin pages open in a separate tab instead of an embedded surface.", "error");
    const selectedMode = mode === "compat" ? "compat" : "safe";
    node.embedMode = selectedMode;
    const body = $(".node-body", article);
    if (!body) return;
    const wrap = document.createElement("div");
    wrap.className = "iframe-wrap";
    const toolbar = document.createElement("div");
    toolbar.className = "iframe-toolbar";
    const modeAction = selectedMode === "compat" ? "safe-mode" : "compatibility";
    const modeLabel = selectedMode === "compat" ? "Safe mode" : "Compatibility";
    const modeTitle = selectedMode === "compat"
      ? "Return to the restricted sandbox"
      : "Enable site origin and storage compatibility (trusted sites only)";
    toolbar.innerHTML =
      '<strong>' + escapeHTML(hostOf(node.url)) + '</strong>' +
      '<span class="iframe-tools">' +
      '<button class="iframe-mode" data-action="' + modeAction + '" title="' + modeTitle + '">' + modeLabel + '</button>' +
      '<button class="iframe-tool" data-action="reload" title="Reload"><svg class="icon"><use href="#i-refresh"/></svg></button>' +
      '<button class="iframe-tool" data-action="open" title="Open in browser"><svg class="icon"><use href="#i-external"/></svg></button>' +
      '</span>';
    const frame = document.createElement("iframe");
    frame.className = "website-frame";
    frame.title = node.title;
    frame.loading = "eager";
    frame.referrerPolicy = "no-referrer";
    frame.allow = "clipboard-read; clipboard-write; fullscreen; picture-in-picture";
    frame.setAttribute("sandbox", selectedMode === "compat" ? COMPATIBILITY_FRAME_SANDBOX : SAFE_FRAME_SANDBOX);
    frame.dataset.embedMode = selectedMode;
    frame.src = node.url;
    const fallback = document.createElement("div");
    fallback.className = "frame-fallback";
    fallback.textContent = selectedMode === "compat"
      ? "Compatibility is enabled. If this still fails, the site may block framing or restrict third-party cookies. Open it in a browser tab."
      : "Restricted sandbox is active. If the app needs origin/storage access, try Compatibility. Sites may still block framing.";
    wrap.append(toolbar, frame, fallback);
    body.replaceChildren(wrap);
    toast(selectedMode === "compat"
      ? "Compatibility Preview enabled for " + node.title + "."
      : "Trying restricted preview for " + node.title + ".");
  }

  function openWebsiteUrl(node) {
    window.open(node.url, "_blank", "noopener,noreferrer");
    toast("Opening " + node.title + " in a new browser tab.");
  }

  function openWebsite(node) {
    openWebsiteUrl(node);
  }

  function updateBridgeStatus() {
    const title = $("#bridgeStatusTitle");
    const detail = $("#bridgeStatusText");
    const pill = $("#bridgeStatusPill");
    const panel = $(".bridge-status-large");
    const sidebar = $("#bridgeSidebarState");
    const connectedNow = nativeHostAvailable;
    if (title) title.textContent = connectedNow ? "Nolane Windows Bridge connected" : "Windows bridge not connected";
    if (detail) detail.textContent = connectedNow
      ? "Windows is running in the background. Website cards use real WebView2 surfaces."
      : "Start the Windows background bridge, then allow this website to connect to the local service once.";
    if (pill) pill.textContent = connectedNow ? "Connected" : "Not connected";
    if (panel) panel.classList.toggle("connected", connectedNow);
    if (sidebar) sidebar.innerHTML = '<i class="status-dot' + (connectedNow ? ' green' : '') + '"></i> ' + (connectedNow ? "Windows bridge" : "Connect Windows");
    const footer = $("#bridgeFooterState");
    if (footer) footer.textContent = connectedNow ? "Windows background bridge · Connected" : "Windows background bridge · Not connected";
    const connectButton = $("#connectWindowsBridgeButton");
    if (connectButton) {
      connectButton.disabled = connectedNow || nativeBridgePermission === "denied";
      connectButton.textContent = connectedNow ? "Connected" :
        nativeBridgePermission === "denied" ? "Enable loopback access in site settings" : "Connect Windows bridge";
    }
  }

  async function refreshWindowsBridgePermission() {
    try {
      const permission = await navigator.permissions.query({ name: "loopback-network" });
      nativeBridgePermission = permission.state;
      permission.onchange = () => {
        nativeBridgePermission = permission.state;
        updateBridgeStatus();
        if (nativeBridgePermission === "granted" && !nativeHostAvailable) connectWindowsBridge();
      };
    } catch (_) { nativeBridgePermission = "unknown"; }
    updateBridgeStatus();
  }

  function connectWindowsBridge() {
    if (nativeHostAvailable || nativeBridgeSocket?.readyState === WebSocket.CONNECTING ||
        nativeBridgeSocket?.readyState === WebSocket.OPEN) return;
    if (!window.isSecureContext) return toast("The Windows bridge requires the secure HTTPS Nolane website.", "error");
    let socket;
    try { socket = new WebSocket("ws://127.0.0.1:43172/bridge", "nolane.infinite.v2"); }
    catch (_) { return toast("Could not open the local connection. Check that the Windows bridge is running.", "error"); }
    nativeBridgeSocket = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "nolane.bridge.hello", protocol: 2, page: location.href }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      handleNativeHostMessage(message);
      if (message.type === "nolane.native.ready") {
        sendNativeBridgeMessage({ type: "nolane.workspace.visibility", protocol: 2, visible: document.visibilityState === "visible" });
        scheduleNativeSurfaceSync();
      }
    });
    socket.addEventListener("error", () => {
      if (!nativeHostAvailable) updateBridgeStatus();
    });
    socket.addEventListener("close", () => {
      if (nativeBridgeSocket === socket) nativeBridgeSocket = null;
      const wasConnected = nativeHostAvailable;
      nativeHostAvailable = false;
      nativeHostReadyNotified = false;
      nativeWorkspaceSnapshotProtocol = false;
      clearNativeWorkspaceSnapshotRetry();
      nativeWorkspaceSnapshotPendingRevision = 0;
      nativeWorkspaceIdsDirty = true;
      nativeProfileUsageDirty = true;
      refreshNativeWorkspaceIdsSnapshot();
      nativeSurfaceStates.clear();
      renderNodes();
      updateBridgeStatus();
      if (wasConnected) toast("Windows background bridge disconnected.", "error");
      queueWindowsBridgeReconnect();
    }, { once: true });
  }

  function queueWindowsBridgeReconnect() {
    if (nativeBridgeReconnectTimer || nativeHostAvailable || nativeBridgePermission !== "granted" ||
        document.visibilityState !== "visible") return;
    // The background host may start after the website or restart for a WebView2 runtime update.
    // Keep retrying with a bounded 30-second delay instead of exhausting a small fixed attempt count.
    const exponent = Math.min(nativeBridgeReconnectAttempts, 8);
    nativeBridgeReconnectAttempts = Math.min(nativeBridgeReconnectAttempts + 1, 8);
    const delay = Math.min(30000, 800 * Math.pow(1.7, exponent));
    nativeBridgeReconnectTimer = window.setTimeout(() => {
      nativeBridgeReconnectTimer = 0;
      connectWindowsBridge();
    }, delay);
  }

  async function initializeWindowsBridge() {
    await refreshWindowsBridgePermission();
    if (nativeBridgePermission === "granted") connectWindowsBridge();
    window.setInterval(() => {
      if (nativeHostAvailable) scheduleNativeSurfaceSync();
    }, 220);
  }

  function deleteNode(id) {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    nodes = nodes.filter((item) => item.id !== id);
    if (selectedId === id) selectedId = null;
    renderNodes();
    scheduleSave();
    toast("Removed " + (node.title || "item") + " from your canvas.");
  }

  function startNodeDrag(event, id) {
    if (event.button !== 0 || spacePressed || event.target.closest(".node-actions")) return;
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    selectNode(id);
    dragState = { id, pointerX: event.clientX, pointerY: event.clientY, x: node.x, y: node.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function startNodeResize(event, id) {
    if (event.button !== 0 || spacePressed) return;
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    selectNode(id);
    resizeState = { id, pointerX: event.clientX, pointerY: event.clientY, w: node.w, h: node.h };
    event.preventDefault();
    event.stopPropagation();
  }

  function pointerMove(event) {
    if (dragState) {
      const node = spatialIndex.get(dragState.id);
      if (!node) return;
      node.x = normalizeCanvasCoordinate(
        Math.round(dragState.x + (event.clientX - dragState.pointerX) / view.scale), dragState.x
      );
      node.y = normalizeCanvasCoordinate(
        Math.round(dragState.y + (event.clientY - dragState.pointerY) / view.scale), dragState.y
      );
      spatialIndex.upsert(node);
      const element = renderedNodeElements.get(node.id);
      if (element) positionCanvasNodeElement(element, node);
      updateMinimap(true);
      scheduleNativeSurfaceSync();
      return;
    }
    if (resizeState) {
      const node = spatialIndex.get(resizeState.id);
      if (!node) return;
      node.w = Math.round(clamp(resizeState.w + (event.clientX - resizeState.pointerX) / view.scale, 230, 1800));
      node.h = Math.round(clamp(resizeState.h + (event.clientY - resizeState.pointerY) / view.scale, 150, 1200));
      spatialIndex.upsert(node);
      const element = renderedNodeElements.get(node.id);
      if (element) { element.style.width = node.w + "px"; element.style.height = node.h + "px"; }
      updateMinimap(true);
      scheduleNativeSurfaceSync();
      return;
    }
    if (panState) {
      view = normalizeCanvasView({
        x: panState.x + (event.clientX - panState.pointerX),
        y: panState.y + (event.clientY - panState.pointerY),
        scale: view.scale
      });
      applyView();
    }
  }

  function pointerUp() {
    if (dragState || resizeState || panState) scheduleSave();
    dragState = null;
    resizeState = null;
    panState = null;
    canvas.classList.remove("is-panning");
  }

  function beginPan(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (!spacePressed && event.target.closest(".node,.canvas-chip,.canvas-controls,.minimap,button,a,input")) return;
    if (spacePressed && event.target.closest(".canvas-controls,.minimap,button,a,input")) return;
    panState = { pointerX: event.clientX, pointerY: event.clientY, x: view.x, y: view.y };
    canvas.classList.add("is-panning");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function createWebsite(rawUrl, title) {
    if (nodes.length >= MAX_NODES) { toast("This workspace has reached its current limit of " + MAX_NODES + " items.", "error"); return false; }
    let url;
    try { url = normalizeUrl(rawUrl); } catch (error) { return toast(error.message, "error"); }
    const rect = canvas.getBoundingClientRect();
    const point = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const host = hostOf(url);
    const node = {
      id: uid(), type: "website", title: (title || host).trim().slice(0, 120) || host, url,
      description: "Connect the Windows background bridge to use a native browser surface in this workspace.",
      embedMode: "safe",
      x: normalizeCanvasCoordinate(Math.round(point.x - 190)),
      y: normalizeCanvasCoordinate(Math.round(point.y - 145)), w: 390, h: 300,
      z: ++zCounter, createdAt: new Date().toISOString()
    };
    nodes.push(node);
    activeView = "canvas";
    renderNodes();
    selectNode(node.id);
    scheduleSave();
    toast("Added " + node.title + " to your canvas.");
    return true;
  }

  function createNote(title, content, color) {
    if (!editingId && nodes.length >= MAX_NODES) { toast("This workspace has reached its current limit of " + MAX_NODES + " items.", "error"); return false; }
    const rect = canvas.getBoundingClientRect();
    const point = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const node = {
      id: editingId || uid(), type: "note", title: (title || "Untitled note").trim().slice(0, 120) || "Untitled note",
      content: String(content || "").slice(0, 12000), color: color || "lavender",
      x: normalizeCanvasCoordinate(Math.round(point.x - 170)),
      y: normalizeCanvasCoordinate(Math.round(point.y - 130)), w: 350, h: 260,
      z: ++zCounter, createdAt: new Date().toISOString()
    };
    if (editingId) {
      const index = nodes.findIndex((item) => item.id === editingId);
      if (index >= 0) {
        node.x = nodes[index].x; node.y = nodes[index].y; node.w = nodes[index].w; node.h = nodes[index].h;
        node.createdAt = nodes[index].createdAt;
        nodes[index] = node;
      } else nodes.push(node);
    } else nodes.push(node);
    editingId = null;
    activeView = "canvas";
    renderNodes();
    selectNode(node.id);
    scheduleSave();
    toast("Note saved to your workspace.");
    return true;
  }

  function editNote(node) {
    editingId = node.id;
    switchTab("note");
    $("#noteTitle").value = node.title;
    $("#noteBody").value = node.content;
    noteColor = node.color || "lavender";
    updateColorChoices();
    $("#createButton").innerHTML = 'Save changes <svg class="icon"><use href="#i-check"/></svg>';
    addDialog.showModal();
    $("#noteTitle").focus();
  }

  function switchTab(tab) {
    activeTab = tab;
    $$(".modal-tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    $("#websitePanel").classList.toggle("active", tab === "website");
    $("#notePanel").classList.toggle("active", tab === "note");
    $("#createButton").innerHTML = (editingId ? "Save changes" : "Add to workspace") + ' <svg class="icon"><use href="#i-chevron"/></svg>';
  }

  function openAddDialog(tab) {
    editingId = null;
    $("#websiteUrl").value = "";
    $("#websiteTitle").value = "";
    $("#noteTitle").value = "";
    $("#noteBody").value = "";
    $("#createButton").innerHTML = 'Add to workspace <svg class="icon"><use href="#i-chevron"/></svg>';
    switchTab(tab || "website");
    if (!addDialog.open) addDialog.showModal();
    setTimeout(() => (tab === "note" ? $("#noteTitle") : $("#websiteUrl")).focus(), 50);
  }

  function updateColorChoices() {
    $$(".color-choice").forEach((button) => button.classList.toggle("active", button.dataset.color === noteColor));
  }

  function changeView(nextView) {
    activeView = nextView;
    updateViewFilter();
    if (nextView !== "canvas") {
      const visible = nodes.filter((node) => (nextView === "websites" ? node.type === "website" : node.type === "note"));
      if (visible.length) fitCanvas(visible);
    }
  }

  function updateMinimap(geometryChanged) {
    if (geometryChanged) minimapGeometryDirty = true;
    if (minimapFrame) return;
    minimapFrame = requestAnimationFrame(() => { minimapFrame = 0; drawMinimap(); });
  }

  function drawMinimap() {
    const content = $("#minimapContent");
    const minimapCanvas = $("#minimapCanvas");
    const viewport = $("#minimapViewport");
    if (!content || !minimapCanvas || !viewport || $("#minimap").classList.contains("hidden")) return;
    const bounds = content.getBoundingClientRect();
    const width = bounds.width || 154, height = bounds.height || 83;
    const pixelRatio = clamp(Number(window.devicePixelRatio) || 1, 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    const resized = minimapCanvas.width !== pixelWidth || minimapCanvas.height !== pixelHeight;
    if (resized) {
      minimapCanvas.width = pixelWidth;
      minimapCanvas.height = pixelHeight;
      minimapGeometryDirty = true;
    }
    const context = minimapCanvas.getContext("2d");
    if (!context) return;

    if (minimapGeometryDirty || !minimapGeometryCache) {
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      const valid = nodes.filter((node) => node && Number.isFinite(node.x) && Number.isFinite(node.y) &&
        Number.isFinite(node.w) && Number.isFinite(node.h));
      if (!valid.length) {
        minimapGeometryCache = null;
        minimapGeometryDirty = false;
        viewport.hidden = true;
        return;
      }
      const minX = Math.min(...valid.map((node) => node.x));
      const minY = Math.min(...valid.map((node) => node.y));
      const maxX = Math.max(...valid.map((node) => node.x + node.w));
      const maxY = Math.max(...valid.map((node) => node.y + node.h));
      const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
      const pad = 4, mapWidth = Math.max(1, width - pad * 2), mapHeight = Math.max(1, height - pad * 2);
      context.save();
      context.scale(pixelRatio, pixelRatio);
      for (const node of valid) {
        context.fillStyle = node.type === "note" ? "rgba(182, 154, 117, 0.88)" : "rgba(131, 113, 213, 0.82)";
        const x = pad + (node.x - minX) / spanX * mapWidth;
        const y = pad + (node.y - minY) / spanY * mapHeight;
        context.fillRect(x, y, Math.max(2, node.w / spanX * mapWidth), Math.max(2, node.h / spanY * mapHeight));
      }
      context.restore();
      minimapGeometryCache = { minX, minY, spanX, spanY, pad, mapWidth, mapHeight };
      minimapGeometryDirty = false;
    }

    const geometry = minimapGeometryCache;
    if (!geometry) {
      viewport.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const worldLeft = -view.x / view.scale, worldTop = -view.y / view.scale;
    viewport.hidden = false;
    viewport.style.left = (geometry.pad + (worldLeft - geometry.minX) / geometry.spanX * geometry.mapWidth) + "px";
    viewport.style.top = (geometry.pad + (worldTop - geometry.minY) / geometry.spanY * geometry.mapHeight) + "px";
    viewport.style.width = clamp((rect.width / view.scale) / geometry.spanX * geometry.mapWidth, 8, geometry.mapWidth) + "px";
    viewport.style.height = clamp((rect.height / view.scale) / geometry.spanY * geometry.mapHeight, 8, geometry.mapHeight) + "px";
  }

  function toast(message, kind) {
    const element = document.createElement("div");
    element.className = "toast" + (kind === "error" ? " error" : "");
    element.innerHTML = (kind === "error" ? '<svg class="icon"><use href="#i-info"/></svg>' : '<svg class="icon"><use href="#i-check"/></svg>') + "<span>" + escapeHTML(message) + "</span>";
    toastRegion.appendChild(element);
    setTimeout(() => element.remove(), 3300);
  }

  function exportWorkspace() {
    const blob = new Blob([JSON.stringify(workspaceSnapshot(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nolane-infinite-workspace.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Workspace exported as a JSON file.");
  }

  async function importWorkspace(file) {
    if (!file) return;
    if (file.size > 24 * 1024 * 1024) return toast("Workspace file is too large (maximum 24 MB).", "error");
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.schema !== "nolane-infinite-workspace") throw new Error("This file is not a Nolane workspace export.");

      let importedSpaces = [];
      let importedActiveId = "personal";
      if (Array.isArray(data.spaces) && data.spaces.length) {
        importedSpaces = normalizeSpaceCollection(data.spaces);
        if (!importedSpaces.length) throw new Error("No valid workspaces were found in this file.");
        importedActiveId = importedSpaces.some((space) => space.id === data.activeSpaceId) ? data.activeSpaceId : importedSpaces[0].id;
      } else if (Array.isArray(data.nodes)) {
        const importedNodes = normalizeNodeCollection(data.nodes);
        importedSpaces = [{
          id: "personal",
          name: "My workspace",
          nodes: importedNodes,
          view: normalizeCanvasView(data.view)
        }];
        importedActiveId = "personal";
      } else {
        throw new Error("The workspace file does not contain any spaces or canvas items.");
      }

      // Commit the import only after the complete file has been parsed and validated.
      spaces = importedSpaces;
      activeSpaceId = importedActiveId;
      const current = activeSpace();
      nodes = current.nodes.map((node) => ({ ...node }));
      view = { ...current.view };
      selectedId = null;
      editingId = null;
      activeView = "canvas";
      $("#searchInput").value = "";
      renderSpaces();
      renderNodes();
      applyView();
      scheduleSave();
      toast("Imported " + spaces.length + " workspaces.");
    } catch (error) {
      toast(error.message || "Could not read that workspace file.", "error");
    }
    fileInput.value = "";
  }

  function initEvents() {
    addForm.addEventListener("submit", (event) => event.preventDefault());
    $("#addButton").addEventListener("click", () => openAddDialog("website"));
    $("#downloadsButton")?.addEventListener("click", () => sendNativePanelCommand("downloads"));
    $("#libraryButton")?.addEventListener("click", () => sendNativePanelCommand("library"));
    $("#profilesButton")?.addEventListener("click", () => sendNativePanelCommand("profiles"));
    $("#bridgeButton").addEventListener("click", () => { $("#bridgeDialog").showModal(); refreshWindowsBridgePermission(); });
    $("#connectWindowsBridgeButton")?.addEventListener("click", connectWindowsBridge);
    initializeWindowsBridge();
    $("#helpButton").addEventListener("click", () => $("#helpDialog").showModal());
    $("#importButton").addEventListener("click", () => fileInput.click());
    $("#exportButton").addEventListener("click", exportWorkspace);
    fileInput.addEventListener("change", (event) => importWorkspace(event.target.files[0]));
    $("#createButton").addEventListener("click", () => {
      if (activeTab === "website") {
        const created = createWebsite($("#websiteUrl").value, $("#websiteTitle").value);
        if (created && addDialog.open) addDialog.close();
      } else {
        const created = createNote($("#noteTitle").value, $("#noteBody").value, noteColor);
        if (created && addDialog.open) addDialog.close();
      }
    });
    $$(".modal-tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
    $$(".quick-add").forEach((button) => button.addEventListener("click", () => {
      $("#websiteUrl").value = button.dataset.url;
      $("#websiteTitle").value = button.querySelector("span:nth-child(2)").textContent;
      $("#websiteUrl").focus();
    }));
    $$(".color-choice").forEach((button) => button.addEventListener("click", () => {
      noteColor = button.dataset.color;
      updateColorChoices();
    }));
    $("#zoomIn").addEventListener("click", () => { const rect = canvas.getBoundingClientRect(); zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.16); });
    $("#zoomOut").addEventListener("click", () => { const rect = canvas.getBoundingClientRect(); zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.16); });
    $("#zoomValue").addEventListener("click", () => { const rect = canvas.getBoundingClientRect(); const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2; zoomAt(cx, cy, 1 / view.scale); });
    $("#fitButton").addEventListener("click", fitCanvas);
    $("#resetButton").addEventListener("click", () => { view = { x: 25, y: 0, scale: .88 }; applyView(); scheduleSave(); });
    $("#minimapButton").addEventListener("click", () => {
      $("#minimap").classList.toggle("hidden");
      updateMinimap();
    });
    $("#searchInput").addEventListener("input", updateViewFilter);
    $("#searchInput").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      focusSearchResult(event.shiftKey);
    });
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
    $("#newSpaceBtn").addEventListener("click", createSpace);
    $("#workspaceMenu").addEventListener("click", () => toast("Choose a space from the sidebar. Use the menu beside a space to rename it."));
    $("#emptyAddWebsite").addEventListener("click", () => openAddDialog("website"));
    $("#emptyAddNote").addEventListener("click", () => openAddDialog("note"));
    $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    canvas.addEventListener("pointerdown", beginPan);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", (event) => {
      if (event.target.closest(".node") && event.ctrlKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * .0012);
      zoomAt(event.clientX, event.clientY, factor);
    }, { passive: false });
    window.addEventListener("keydown", (event) => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.activeElement?.isContentEditable;
      const dialogOpen = !!$("dialog[open]");
      if (event.code === "Space" && !typing && !dialogOpen) { spacePressed = true; canvas.classList.add("space-pan"); event.preventDefault(); }
      if (typing || dialogOpen || event.metaKey || event.ctrlKey || event.altKey) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveWorkspace().then(() => toast("Workspace saved on this device.")); }
        return;
      }
      if (event.key === "/" && !typing) { event.preventDefault(); $("#searchInput").focus(); }
      if (event.key.toLowerCase() === "a") openAddDialog("website");
      if (event.key.toLowerCase() === "n") openAddDialog("note");
      if (event.key === "Escape") { if ($("#sidebar").classList.contains("open")) $("#sidebar").classList.remove("open"); }
      if (event.key === "Delete" && selectedId) deleteNode(selectedId);
    });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") { spacePressed = false; canvas.classList.remove("space-pan"); }
    });
    window.addEventListener("blur", () => { spacePressed = false; canvas.classList.remove("space-pan"); pointerUp(); });
    window.addEventListener("resize", () => {
      scheduleCanvasVirtualization();
      updateMinimap();
      scheduleNativeSurfaceSync();
    });
    if (typeof ResizeObserver === "function") {
      canvasResizeObserver = new ResizeObserver(() => {
        scheduleCanvasVirtualization();
        updateMinimap();
        scheduleNativeSurfaceSync();
      });
      canvasResizeObserver.observe(canvas);
    }
    window.addEventListener("pagehide", () => {
      clearNativeWorkspaceSnapshotRetry();
      nativeBridgeSocket?.close(1000, "Workspace page closed");
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceSnapshot())); } catch (_) {}
    });
  }

    function registerServiceWorker() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => console.warn("Service worker registration failed:", error));
    }
  }

  initEvents();
  loadWorkspace().catch((error) => {
    console.error(error);
    spaces = defaultSpaces();
    activeSpaceId = "personal";
    nodes = activeSpace().nodes.map((node) => ({ ...node }));
    view = { ...activeSpace().view };
    renderSpaces();
    renderNodes();
    applyView();
    toast("Local storage could not be opened. This session will still work.", "error");
  });
  registerServiceWorker();
})();