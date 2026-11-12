(() => {
  "use strict";

  const DB_NAME = "nolane-infinite";
  const DB_VERSION = 1;
  const STORE_NAME = "workspace";
  const STORAGE_KEY = "nolane-infinite-workspace-v1";
  const MAX_NODES = 150;
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
  let bridgeConnected = false;
  let bridgeSessionId = "";
  const liveSurfaces = new Map();

  const uid = () => "node-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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

  function normalizeSpace(space, index) {
    if (!space || typeof space !== "object") return null;
    const id = String(space.id || uid()).slice(0, 80);
    const name = String(space.name || ("Space " + (index + 1))).trim().slice(0, 48) || ("Space " + (index + 1));
    const cleanNodes = Array.isArray(space.nodes) ? space.nodes.map(validateNode).filter(Boolean).slice(0, MAX_NODES) : [];
    const rawView = space.view || {};
    const cleanView = Number.isFinite(rawView.x) && Number.isFinite(rawView.y) && Number.isFinite(rawView.scale)
      ? { x: clamp(rawView.x, -100000, 100000), y: clamp(rawView.y, -100000, 100000), scale: clamp(rawView.scale, MIN_SCALE, MAX_SCALE) }
      : { x: 25, y: 0, scale: 1 };
    return { id, name, nodes: cleanNodes, view: cleanView };
  }

  function activeSpace() {
    return spaces.find((space) => space.id === activeSpaceId) || spaces[0] || null;
  }

  function syncActiveSpace() {
    const current = activeSpace();
    if (!current) return;
    current.nodes = nodes.map((node) => ({ ...node }));
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
      spaces = saved.spaces.map(normalizeSpace).filter(Boolean).slice(0, 12);
      activeSpaceId = spaces.some((space) => space.id === saved.activeSpaceId) ? saved.activeSpaceId : spaces[0].id;
      const current = activeSpace();
      nodes = current.nodes.map((node) => ({ ...node }));
      view = { ...current.view };
      toast("Your local workspaces were restored.");
    } else if (saved && Array.isArray(saved.nodes)) {
      nodes = saved.nodes.map(validateNode).filter(Boolean).slice(0, MAX_NODES);
      if (saved.view && Number.isFinite(saved.view.x) && Number.isFinite(saved.view.y) && Number.isFinite(saved.view.scale)) {
        view = { x: saved.view.x, y: saved.view.y, scale: clamp(saved.view.scale, MIN_SCALE, MAX_SCALE) };
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

  function validateNode(node) {
    if (!node || typeof node !== "object" || !["website", "note"].includes(node.type)) return null;
    const clean = {
      id: String(node.id || uid()).slice(0, 80),
      type: node.type,
      title: String(node.title || (node.type === "note" ? "Untitled note" : "Website")).slice(0, 120),
      x: clamp(Number(node.x) || 0, -100000, 100000),
      y: clamp(Number(node.y) || 0, -100000, 100000),
      w: clamp(Number(node.w) || 360, 230, 1800),
      h: clamp(Number(node.h) || 280, 150, 1200),
      z: clamp(Number(node.z) || 1, 1, 100000),
      createdAt: node.createdAt || new Date().toISOString()
    };
    if (node.type === "website") {
      try { clean.url = normalizeUrl(node.url); } catch (_) { return null; }
      clean.description = String(node.description || "A website in your workspace.").slice(0, 240);
      clean.embedMode = node.embedMode === "compat" ? "compat" : "safe";
      if (Number.isInteger(node.browserTabId) && node.browserTabId >= 0) clean.browserTabId = node.browserTabId;
      if (Number.isInteger(node.browserWindowId) && node.browserWindowId >= 0) clean.browserWindowId = node.browserWindowId;
      if (typeof node.browserSessionId === "string" && node.browserSessionId.length >= 20 && node.browserSessionId.length <= 80) clean.browserSessionId = node.browserSessionId;
    } else {
      clean.content = String(node.content || "").slice(0, 12000);
      clean.color = ["lavender", "mint", "peach", "blue"].includes(node.color) ? node.color : "lavender";
    }
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
        nodes: space.nodes.map((node) => ({ ...node }))
      }))
    };
  }

  function scheduleSave(delay) {
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
    world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.scale + ")";
    grid.style.backgroundPosition = (view.x % (24 * view.scale)) + "px " + (view.y % (24 * view.scale)) + "px";
    $("#zoomValue").textContent = Math.round(view.scale * 100) + "%";
    updateMinimap();
  }

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
    view.x = px - anchorX * next;
    view.y = py - anchorY * next;
    view.scale = next;
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
    view.scale = scale;
    view.x = (rect.width - (maxX - minX) * scale) / 2 - minX * scale;
    view.y = (rect.height - (maxY - minY) * scale) / 2 - minY * scale;
    applyView();
    scheduleSave();
  }

  function updateCounts() {
    $("#websiteCount").textContent = nodes.filter((node) => node.type === "website").length;
    $("#noteCount").textContent = nodes.filter((node) => node.type === "note").length;
  }

  function renderNodes() {
    world.replaceChildren();
    nodes.forEach((node) => world.appendChild(createNodeElement(node)));
    updateViewFilter();
    updateCounts();
    renderSpaces();
    updateMinimap();
  }

  function createNodeElement(node) {
    const article = document.createElement("article");
    article.className = "node" + (node.id === selectedId ? " selected" : "");
    article.dataset.id = node.id;
    article.style.left = node.x + "px";
    article.style.top = node.y + "px";
    article.style.width = node.w + "px";
    article.style.height = node.h + "px";
    article.style.zIndex = node.z || 1;
    const header = document.createElement("div");
    header.className = "node-header";
    header.innerHTML =
      '<span class="node-favicon">' + (node.type === "website" ? escapeHTML(initials(hostOf(node.url))) : '<svg class="icon"><use href="#i-sticky"/></svg>') + '</span>' +
      '<span class="node-title-wrap"><span class="node-title">' + escapeHTML(node.title) + '</span><span class="node-subtitle">' + escapeHTML(node.type === "website" ? ((node.browserTabId !== undefined ? "Chrome tab · " : "") + hostOf(node.url)) : "Personal note") + '</span></span>' +
      '<span class="node-actions">' +
        (node.type === "website" ? '<button class="node-action" data-action="open" title="' + (node.browserTabId !== undefined ? "Switch to existing Chrome tab" : "Open in browser") + '"><svg class="icon"><use href="#i-external"/></svg></button>' : '<button class="node-action" data-action="edit" title="Edit note"><svg class="icon"><use href="#i-sticky"/></svg></button>') +
        '<button class="node-action" data-action="delete" title="Remove"><svg class="icon"><use href="#i-x"/></svg></button>' +
      '</span>';
    article.appendChild(header);

    const body = document.createElement("div");
    body.className = "node-body";
    if (node.type === "website" && liveSurfaces.has(node.id)) {
      body.appendChild(createLiveSurfaceElement(node, liveSurfaces.get(node.id)));
    } else if (node.type === "website") {
      const previewActions = node.browserTabId !== undefined
        ? '<div class="preview-actions"><button class="mini-button" data-action="open"><svg class="icon"><use href="#i-external"/></svg> Focus source tab</button><button class="mini-button secondary" data-action="open-url">Open URL</button><button class="mini-button secondary" data-action="live-help">Stream help</button></div>'
        : '<div class="preview-actions"><button class="mini-button" data-action="open"><svg class="icon"><use href="#i-external"/></svg> Open tab</button><button class="mini-button secondary" data-action="live-help">Create live surface</button></div>';
      body.innerHTML =
        '<div class="web-preview">' +
          '<div class="preview-mark">' + escapeHTML(initials(hostOf(node.url))) + '</div>' +
          '<div class="preview-title">' + escapeHTML(node.title) + '</div>' +
          '<div class="preview-domain">' + escapeHTML(hostOf(node.url)) + '</div>' +
          '<p class="preview-description">' + escapeHTML(node.description || "Open this website in Chrome, then stream its real tab into this card.") + '</p>' +
          previewActions +
          '<div class="embed-note">Live view uses the real Chrome tab; it does not rely on iframe embedding.</div>' +
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


  function postLiveInput(surface, payload) {
    window.postMessage({
      source: "nolane-workspace",
      type: "LIVE_INPUT",
      surfaceId: surface.surfaceId,
      browserSessionId: surface.browserSessionId,
      ...payload
    }, location.origin);
  }

  function createLiveSurfaceElement(node, surface) {
    const root = document.createElement("div");
    root.className = "live-surface";
    const toolbar = document.createElement("div");
    toolbar.className = "live-surface-toolbar";
    toolbar.innerHTML =
      '<span class="live-indicator"><i></i> LIVE CHROME TAB</span>' +
      '<span class="live-surface-actions">' +
      '<button class="live-tool" data-action="focus-live" title="Focus the original Chrome tab">Focus source</button>' +
      '<button class="live-tool danger" data-action="stop-live" title="Stop live capture">Stop</button>' +
      '</span>';
    const stage = document.createElement("div");
    stage.className = "live-surface-stage";
    stage.tabIndex = 0;
    stage.setAttribute("role", "application");
    stage.setAttribute("aria-label", "Live Chrome page. Click to send mouse and keyboard input to the original tab.");
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = surface.stream;
    const hint = document.createElement("div");
    hint.className = "live-surface-hint";
    hint.textContent = "Click inside to interact · Input is sent to the original Chrome tab";
    stage.append(video, hint);

    function coordinates(event) {
      const rect = stage.getBoundingClientRect();
      const videoWidth = video.videoWidth || surface.viewport.width;
      const videoHeight = video.videoHeight || surface.viewport.height;
      const aspect = videoWidth / Math.max(1, videoHeight);
      const boxAspect = rect.width / Math.max(1, rect.height);
      let contentWidth = rect.width;
      let contentHeight = rect.height;
      if (aspect > boxAspect) contentHeight = rect.width / aspect;
      else contentWidth = rect.height * aspect;
      const offsetX = (rect.width - contentWidth) / 2;
      const offsetY = (rect.height - contentHeight) / 2;
      const localX = event.clientX - rect.left - offsetX;
      const localY = event.clientY - rect.top - offsetY;
      if (localX < 0 || localY < 0 || localX > contentWidth || localY > contentHeight) return null;
      return {
        x: Math.max(0, Math.min(surface.viewport.width, localX / contentWidth * surface.viewport.width)),
        y: Math.max(0, Math.min(surface.viewport.height, localY / contentHeight * surface.viewport.height))
      };
    }

    function modifiers(event) {
      return {
        altKey: !!event.altKey,
        ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey,
        shiftKey: !!event.shiftKey
      };
    }

    let lastMoveAt = 0;
    stage.addEventListener("pointerdown", (event) => {
      const point = coordinates(event);
      if (!point) return;
      stage.focus({ preventScroll: true });
      try { stage.setPointerCapture(event.pointerId); } catch (_) {}
      postLiveInput(surface, {
        kind: "mousePressed", ...point,
        button: event.button === 2 ? "right" : event.button === 1 ? "middle" : "left",
        buttons: event.buttons || 1,
        clickCount: event.detail || 1,
        ...modifiers(event)
      });
      event.preventDefault();
      event.stopPropagation();
    });
    stage.addEventListener("pointermove", (event) => {
      const now = performance.now();
      if (now - lastMoveAt < 28) return;
      lastMoveAt = now;
      const point = coordinates(event);
      if (!point) return;
      postLiveInput(surface, { kind: "mouseMoved", ...point, buttons: event.buttons || 0, ...modifiers(event) });
      event.preventDefault();
      event.stopPropagation();
    });
    const endPointer = (event) => {
      const point = coordinates(event);
      if (point) {
        postLiveInput(surface, {
          kind: "mouseReleased", ...point,
          button: event.button === 2 ? "right" : event.button === 1 ? "middle" : "left",
          buttons: 0,
          clickCount: event.detail || 1,
          ...modifiers(event)
        });
      }
      try { stage.releasePointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopPropagation();
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("wheel", (event) => {
      const point = coordinates(event);
      if (!point) return;
      postLiveInput(surface, { kind: "mouseWheel", ...point, deltaX: event.deltaX, deltaY: event.deltaY, ...modifiers(event) });
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });
    stage.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); });
    stage.addEventListener("keydown", (event) => {
      postLiveInput(surface, {
        kind: "keyDown",
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        location: event.location,
        repeat: event.repeat,
        text: event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey ? event.key : "",
        unmodifiedText: event.key.length === 1 ? event.key : "",
        ...modifiers(event)
      });
      event.preventDefault();
      event.stopPropagation();
    });
    stage.addEventListener("keyup", (event) => {
      postLiveInput(surface, {
        kind: "keyUp",
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        location: event.location,
        ...modifiers(event)
      });
      event.preventDefault();
      event.stopPropagation();
    });
    stage.addEventListener("compositionend", (event) => {
      if (event.data) postLiveInput(surface, { kind: "insertText", text: event.data });
    });
    root.append(toolbar, stage);
    video.play().catch(() => {});
    return root;
  }

  async function startLiveSurface(message) {
    let stream = null;
    try {
      if (!message || typeof message.surfaceId !== "string" || !Number.isInteger(message.sourceTabId) ||
          typeof message.streamId !== "string" || message.browserSessionId !== bridgeSessionId) {
        throw new Error("The live-stream request did not match this Chrome profile.");
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        throw new Error("This browser page cannot consume a tab stream. Open Nolane over its HTTPS GitHub Pages address.");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: message.streamId
          }
        }
      });

      const safeUrl = normalizeUrl(message.url);
      addBrowserTabsToWorkspace([{
        id: message.sourceTabId,
        url: safeUrl,
        title: String(message.title || hostOf(safeUrl)).slice(0, 120)
      }], message.browserSessionId);
      const node = nodes.find((item) => item.type === "website" &&
        item.browserTabId === message.sourceTabId && item.browserSessionId === message.browserSessionId);
      if (!node) throw new Error("The source tab could not be added to the active workspace.");

      const previous = liveSurfaces.get(node.id);
      if (previous) previous.stream.getTracks().forEach((track) => track.stop());
      const viewport = message.viewport && Number.isFinite(message.viewport.width) && Number.isFinite(message.viewport.height)
        ? { width: Math.max(1, message.viewport.width), height: Math.max(1, message.viewport.height) }
        : { width: 1280, height: 720 };
      liveSurfaces.set(node.id, {
        surfaceId: message.surfaceId,
        sourceTabId: message.sourceTabId,
        browserSessionId: message.browserSessionId,
        viewport,
        stream
      });
      activeView = "canvas";
      $("#searchInput").value = "";
      renderNodes();
      scheduleSave();
      window.postMessage({
        source: "nolane-workspace",
        type: "LIVE_SURFACE_ACK",
        surfaceId: message.surfaceId,
        browserSessionId: message.browserSessionId
      }, location.origin);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.addEventListener("ended", () => stopLiveSurfaceById(message.surfaceId, "Chrome ended the captured tab stream.", false), { once: true });
      toast("Live Chrome surface connected: " + node.title + ".");
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (message && typeof message.surfaceId === "string") {
        window.postMessage({
          source: "nolane-workspace",
          type: "LIVE_SURFACE_ERROR",
          surfaceId: message.surfaceId,
          error: String(error?.message || error).slice(0, 220)
        }, location.origin);
      }
      throw error;
    }
  }

  function stopLiveSurfaceById(surfaceId, reason, notifyExtension = false) {
    let nodeId = "";
    let surface = null;
    for (const [id, item] of liveSurfaces) {
      if (item.surfaceId === surfaceId) { nodeId = id; surface = item; break; }
    }
    if (!surface) return;
    liveSurfaces.delete(nodeId);
    surface.stream.getTracks().forEach((track) => track.stop());
    if (notifyExtension) {
      window.postMessage({
        source: "nolane-workspace",
        type: "LIVE_SURFACE_STOP",
        surfaceId,
        browserSessionId: surface.browserSessionId
      }, location.origin);
    }
    renderNodes();
    if (reason) toast(reason, "error");
  }

  function stopLiveSurface(nodeId) {
    const surface = liveSurfaces.get(nodeId);
    if (!surface) return;
    stopLiveSurfaceById(surface.surfaceId, "Live surface stopped.", true);
  }

  function updateViewFilter() {
    const query = $("#searchInput").value.trim().toLowerCase();
    let visibleCount = 0;
    $$(".node", world).forEach((element) => {
      const node = nodes.find((item) => item.id === element.dataset.id);
      const viewMatch = activeView === "canvas" || (activeView === "websites" && node && node.type === "website") || (activeView === "notes" && node && node.type === "note");
      const searchText = node ? [node.title, node.url || "", node.content || "", node.description || ""].join(" ").toLowerCase() : "";
      const matches = !!(viewMatch && (!query || searchText.includes(query)));
      element.classList.toggle("hidden-by-search", !matches);
      if (matches) visibleCount += 1;
    });
    const titles = { canvas: "My workspace", websites: "Web surfaces", notes: "Notes" };
    $("#viewTitle").textContent = activeView === "canvas" ? (activeSpace()?.name || titles.canvas) : titles[activeView];
    $("#canvasHeading").textContent = activeView === "websites" ? "Your web, gathered." : activeView === "notes" ? "Thoughts, in context." : (activeSpace()?.name || "A space for everything.");
    $("#canvasSubheading").textContent = activeView === "websites" ? "Open, arrange and revisit the websites you use." : activeView === "notes" ? "Keep ideas close to the things they belong to." : "Bring your web tools together. Arrange them your way.";
    const empty = $("#emptyState");
    empty.hidden = visibleCount > 0;
    $("#emptyTitle").textContent = query ? "No matches yet." : activeView === "websites" ? "No websites here yet." : activeView === "notes" ? "No notes here yet." : "A fresh space.";
    $("#emptyDescription").textContent = query ? "Try a different search, or clear the search field." : "Start with a website, a note, or both. Your workspace grows with you.";
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
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
    if (action === "open" && node.type === "website") openWebsite(node);
    if (action === "open-url" && node.type === "website") openWebsiteUrl(node);
    if (action === "delete") deleteNode(node.id);
    if (action === "edit") editNote(node);
    if (action === "embed" && node.type === "website") activateEmbed(node, article, node.embedMode || "safe");
    if (action === "compatibility" && node.type === "website") setEmbedMode(node, article, "compat");
    if (action === "safe-mode" && node.type === "website") setEmbedMode(node, article, "safe");
    if (action === "stop-live" && node.type === "website") stopLiveSurface(node.id);
    if (action === "focus-live" && node.type === "website") openWebsite(node);
    if (action === "live-help" && node.type === "website") toast("Open this website in a Chrome tab, click the Nolane Companion icon there, then choose Stream this tab to Nolane.");
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
    if (node.browserTabId !== undefined && bridgeConnected && node.browserSessionId && node.browserSessionId === bridgeSessionId) {
      window.postMessage({ source: "nolane-workspace", type: "FOCUS_BROWSER_TAB", tabId: node.browserTabId, browserSessionId: node.browserSessionId, expectedOrigin: new URL(node.url).origin }, location.origin);
      toast("Switching to the original Chrome tab for " + node.title + ".");
      return;
    }
    if (node.browserTabId !== undefined && (!bridgeConnected || !node.browserSessionId || node.browserSessionId !== bridgeSessionId)) {
      toast("This tab card belongs to another or disconnected Chrome profile. Opening the website URL instead.");
    }
    openWebsiteUrl(node);
  }

  function setBridgeConnected(connected, sessionId) {
    bridgeConnected = !!connected;
    bridgeSessionId = bridgeConnected && typeof sessionId === "string" ? sessionId : "";
    const title = $("#bridgeStatusTitle");
    const detail = $("#bridgeStatusText");
    const pill = $("#bridgeStatusPill");
    const panel = $(".bridge-status-large");
    const sidebar = $("#bridgeSidebarState");
    if (title) title.textContent = bridgeConnected ? "Browser Companion connected" : "Companion not detected";
    if (detail) detail.textContent = bridgeConnected ? "Your browser can share selected tab links with this workspace." : "Install the local extension, then refresh this page.";
    if (pill) pill.textContent = bridgeConnected ? "Connected" : "Not connected";
    if (panel) panel.classList.toggle("connected", bridgeConnected);
    if (sidebar) sidebar.innerHTML = '<i class="status-dot' + (bridgeConnected ? ' green' : '') + '"></i> ' + (bridgeConnected ? "Connected" : "Not connected");
    const footer = $("#bridgeFooterState");
    if (footer) footer.textContent = bridgeConnected ? "Local companion · Connected" : "Optional local companion · MV3";
  }

  function addBrowserTabsToWorkspace(tabs, sessionId) {
    if (!Array.isArray(tabs) || !tabs.length) return;
    if (typeof sessionId !== "string" || sessionId.length < 20 || sessionId.length > 80) return toast("The companion did not provide a valid browser profile identity.", "error");
    const valid = tabs.map((tab) => {
      if (!tab || !Number.isInteger(tab.id)) return null;
      try {
        return {
          id: tab.id,
          windowId: Number.isInteger(tab.windowId) ? tab.windowId : undefined,
          url: normalizeUrl(tab.url),
          title: String(tab.title || hostOf(tab.url)).slice(0, 120)
        };
      } catch (_) { return null; }
    }).filter(Boolean);
    if (!valid.length) return toast("No supported web tabs were selected.", "error");

    const rect = canvas.getBoundingClientRect();
    const center = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    let added = 0;
    let updated = 0;
    valid.forEach((tab, index) => {
      const existing = nodes.find((node) => node.type === "website" && node.browserTabId === tab.id && node.browserSessionId === sessionId);
      if (existing) {
        existing.url = tab.url;
        existing.title = tab.title || hostOf(tab.url);
        existing.browserWindowId = tab.windowId;
        existing.browserSessionId = sessionId;
        existing.description = "Imported from Chrome. Switch to the original tab to keep using its current login session.";
        updated += 1;
        return;
      }
      if (nodes.length >= MAX_NODES) return;
      const column = index % 3;
      const row = Math.floor(index / 3);
      nodes.push({
        id: uid(),
        type: "website",
        title: tab.title || hostOf(tab.url),
        url: tab.url,
        description: "Imported from Chrome. Switch to the original tab to keep using its current login session.",
        browserTabId: tab.id,
        browserWindowId: tab.windowId,
        browserSessionId: sessionId,
        x: Math.round(center.x - 600 + column * 420),
        y: Math.round(center.y - 170 + row * 330),
        w: 390,
        h: 300,
        z: ++zCounter,
        createdAt: new Date().toISOString()
      });
      added += 1;
    });
    activeView = "canvas";
    $("#searchInput").value = "";
    renderNodes();
    scheduleSave();
    toast("Added " + added + " Chrome tab(s)" + (updated ? " and updated " + updated + " existing card(s)." : " to this workspace."));
  }

  function handleCompanionMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== "nolane-companion") return;
    if (message.type === "COMPANION_READY") {
      setBridgeConnected(!!message.browserSessionId, message.browserSessionId || "");
    } else if (message.type === "LIVE_SURFACE_START") {
      startLiveSurface(message).catch((error) => toast(error.message || "Could not start the live surface.", "error"));
    } else if (message.type === "LIVE_SURFACE_STOPPED") {
      stopLiveSurfaceById(message.surfaceId, message.reason || "Live Chrome surface disconnected.", false);
    } else if (message.type === "TABS_IMPORTED") {
      setBridgeConnected(!!message.browserSessionId, message.browserSessionId || "");
      addBrowserTabsToWorkspace(message.tabs, message.browserSessionId);
    } else if (message.type === "TAB_FOCUSED") {
      if (message.ok) toast("Chrome tab focused.");
      else {
        const node = nodes.find((item) => item.type === "website" && item.browserTabId === message.tabId && item.browserSessionId === message.browserSessionId);
        if (node) {
          node.browserTabId = undefined;
          node.browserWindowId = undefined;
          node.browserSessionId = undefined;
          scheduleSave();
          renderNodes();
          openWebsiteUrl(node);
        }
        toast("The original tab is no longer available. Opened its URL instead.", "error");
      }
    }
  }

  function pingCompanion() {
    window.postMessage({ source: "nolane-workspace", type: "PING_COMPANION" }, location.origin);
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
      const node = nodes.find((item) => item.id === dragState.id);
      if (!node) return;
      node.x = Math.round(dragState.x + (event.clientX - dragState.pointerX) / view.scale);
      node.y = Math.round(dragState.y + (event.clientY - dragState.pointerY) / view.scale);
      const element = $('.node[data-id="' + CSS.escape(node.id) + '"]', world);
      if (element) { element.style.left = node.x + "px"; element.style.top = node.y + "px"; }
      updateMinimap();
      return;
    }
    if (resizeState) {
      const node = nodes.find((item) => item.id === resizeState.id);
      if (!node) return;
      node.w = Math.round(clamp(resizeState.w + (event.clientX - resizeState.pointerX) / view.scale, 230, 1800));
      node.h = Math.round(clamp(resizeState.h + (event.clientY - resizeState.pointerY) / view.scale, 150, 1200));
      const element = $('.node[data-id="' + CSS.escape(node.id) + '"]', world);
      if (element) { element.style.width = node.w + "px"; element.style.height = node.h + "px"; }
      updateMinimap();
      return;
    }
    if (panState) {
      view.x = panState.x + (event.clientX - panState.pointerX);
      view.y = panState.y + (event.clientY - panState.pointerY);
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
      description: "A website surface. Try a restricted preview, enable compatibility for trusted sites, or open it in a browser tab.",
      embedMode: "safe",
      x: Math.round(point.x - 190), y: Math.round(point.y - 145), w: 390, h: 300,
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
      x: Math.round(point.x - 170), y: Math.round(point.y - 130), w: 350, h: 260,
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

  function updateMinimap() {
    const content = $("#minimapContent");
    if (!content || $("#minimap").classList.contains("hidden")) return;
    const valid = nodes.filter((node) => node && Number.isFinite(node.x));
    content.querySelectorAll(".minimap-node").forEach((el) => el.remove());
    if (!valid.length) return;
    const minX = Math.min(...valid.map((n) => n.x));
    const minY = Math.min(...valid.map((n) => n.y));
    const maxX = Math.max(...valid.map((n) => n.x + n.w));
    const maxY = Math.max(...valid.map((n) => n.y + n.h));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const bounds = content.getBoundingClientRect();
    const width = bounds.width || 154;
    const height = bounds.height || 83;
    valid.forEach((node) => {
      const marker = document.createElement("span");
      marker.className = "minimap-node" + (node.type === "note" ? " note" : "");
      marker.style.left = ((node.x - minX) / spanX * (width - 8) + 4) + "px";
      marker.style.top = ((node.y - minY) / spanY * (height - 8) + 4) + "px";
      marker.style.width = Math.max(3, node.w / spanX * (width - 8)) + "px";
      marker.style.height = Math.max(3, node.h / spanY * (height - 8)) + "px";
      content.appendChild(marker);
    });
    const viewport = $("#minimapViewport");
    const rect = canvas.getBoundingClientRect();
    const worldLeft = -view.x / view.scale;
    const worldTop = -view.y / view.scale;
    viewport.style.left = ((worldLeft - minX) / spanX * (width - 8) + 4) + "px";
    viewport.style.top = ((worldTop - minY) / spanY * (height - 8) + 4) + "px";
    viewport.style.width = clamp((rect.width / view.scale) / spanX * (width - 8), 8, width - 8) + "px";
    viewport.style.height = clamp((rect.height / view.scale) / spanY * (height - 8), 8, height - 8) + "px";
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
        importedSpaces = data.spaces.map(normalizeSpace).filter(Boolean).slice(0, 12);
        if (!importedSpaces.length) throw new Error("No valid workspaces were found in this file.");
        importedActiveId = importedSpaces.some((space) => space.id === data.activeSpaceId) ? data.activeSpaceId : importedSpaces[0].id;
      } else if (Array.isArray(data.nodes)) {
        const importedNodes = data.nodes.map(validateNode).filter(Boolean).slice(0, MAX_NODES);
        importedSpaces = [{
          id: "personal",
          name: "My workspace",
          nodes: importedNodes,
          view: {
            x: Number(data.view?.x) || 25,
            y: Number(data.view?.y) || 0,
            scale: clamp(Number(data.view?.scale) || 1, MIN_SCALE, MAX_SCALE)
          }
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
    $("#bridgeButton").addEventListener("click", () => { $("#bridgeDialog").showModal(); pingCompanion(); });
    window.addEventListener("message", handleCompanionMessage);
    pingCompanion();
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
    window.addEventListener("resize", updateMinimap);
    window.addEventListener("pagehide", () => {
      for (const surface of liveSurfaces.values()) {
        window.postMessage({
          source: "nolane-workspace",
          type: "LIVE_SURFACE_STOP",
          surfaceId: surface.surfaceId,
          browserSessionId: surface.browserSessionId
        }, location.origin);
        surface.stream.getTracks().forEach((track) => track.stop());
      }
      liveSurfaces.clear();
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