(() => {
  "use strict";

  const DB_NAME = "nolane-infinite";
  const DB_VERSION = 1;
  const STORE_NAME = "workspace";
  const STORAGE_KEY = "nolane-infinite-workspace-v1";
  const MAX_NODES = 150;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.2;

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

  const uid = () => "node-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const escapeHTML = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const safeDate = (value) => {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };
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
    if (!parsed.hostname || parsed.hostname.indexOf(".") === -1 && parsed.hostname !== "localhost") {
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
    } catch (_) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        saved = raw ? JSON.parse(raw) : null;
      } catch (_) { saved = null; }
    }
    if (saved && Array.isArray(saved.nodes)) {
      nodes = saved.nodes.map(validateNode).filter(Boolean).slice(0, MAX_NODES);
      if (saved.view && Number.isFinite(saved.view.x) && Number.isFinite(saved.view.y) && Number.isFinite(saved.view.scale)) {
        view = { x: saved.view.x, y: saved.view.y, scale: clamp(saved.view.scale, MIN_SCALE, MAX_SCALE) };
      }
      if (!nodes.length) nodes = defaultNodes();
      toast("Workspace restored from this device.");
    } else {
      nodes = defaultNodes();
      toast("Your private workspace is ready.");
    }
    zCounter = Math.max(10, ...nodes.map((node) => Number(node.z) || 0)) + 1;
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
    } else {
      clean.content = String(node.content || "").slice(0, 12000);
      clean.color = ["lavender", "mint", "peach", "blue"].includes(node.color) ? node.color : "lavender";
    }
    return clean;
  }

  function workspaceSnapshot() {
    return {
      schema: "nolane-infinite-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      view: { x: view.x, y: view.y, scale: view.scale },
      nodes: nodes.map((node) => ({ ...node }))
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
      '<span class="node-title-wrap"><span class="node-title">' + escapeHTML(node.title) + '</span><span class="node-subtitle">' + escapeHTML(node.type === "website" ? hostOf(node.url) : "Personal note") + '</span></span>' +
      '<span class="node-actions">' +
        (node.type === "website" ? '<button class="node-action" data-action="open" title="Open in browser"><svg class="icon"><use href="#i-external"/></svg></button>' : '<button class="node-action" data-action="edit" title="Edit note"><svg class="icon"><use href="#i-sticky"/></svg></button>') +
        '<button class="node-action" data-action="delete" title="Remove"><svg class="icon"><use href="#i-x"/></svg></button>' +
      '</span>';
    article.appendChild(header);

    const body = document.createElement("div");
    body.className = "node-body";
    if (node.type === "website") {
      body.innerHTML =
        '<div class="web-preview">' +
          '<div class="preview-mark">' + escapeHTML(initials(hostOf(node.url))) + '</div>' +
          '<div class="preview-title">' + escapeHTML(node.title) + '</div>' +
          '<div class="preview-domain">' + escapeHTML(hostOf(node.url)) + '</div>' +
          '<p class="preview-description">' + escapeHTML(node.description || "Open this website directly from your workspace.") + '</p>' +
          '<div class="preview-actions"><button class="mini-button" data-action="embed"><svg class="icon"><use href="#i-layout"/></svg> Try embedded view</button><button class="mini-button secondary" data-action="open"><svg class="icon"><use href="#i-external"/></svg> Open tab</button></div>' +
          '<div class="embed-note">Embedding depends on the website\'s own security policy.</div>' +
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
    $$(".node", world).forEach((element) => {
      const node = nodes.find((item) => item.id === element.dataset.id);
      const query = $("#searchInput").value.trim().toLowerCase();
      const viewMatch = activeView === "canvas" || (activeView === "websites" && node && node.type === "website") || (activeView === "notes" && node && node.type === "note");
      const searchText = node ? [node.title, node.url || "", node.content || "", node.description || ""].join(" ").toLowerCase() : "";
      element.classList.toggle("hidden-by-search", !viewMatch || (query && !searchText.includes(query)));
    });
    const titles = { canvas: "My workspace", websites: "Web surfaces", notes: "Notes" };
    $("#viewTitle").textContent = titles[activeView] || titles.canvas;
    $("#canvasHeading").textContent = activeView === "websites" ? "Your web, gathered." : activeView === "notes" ? "Thoughts, in context." : "A space for everything.";
    $("#canvasSubheading").textContent = activeView === "websites" ? "Open, arrange and revisit the websites you use." : activeView === "notes" ? "Keep ideas close to the things they belong to." : "Bring your web tools together. Arrange them your way.";
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
    if (action === "delete") deleteNode(node.id);
    if (action === "edit") editNote(node);
    if (action === "embed" && node.type === "website") activateEmbed(node, article);
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

  function activateEmbed(node, article) {
    if (new URL(node.url).origin === location.origin) return toast("For security, same-origin pages open in a separate tab instead of an embedded surface.", "error");
    const body = $(".node-body", article);
    if (!body) return;
    const wrap = document.createElement("div");
    wrap.className = "iframe-wrap";
    const toolbar = document.createElement("div");
    toolbar.className = "iframe-toolbar";
    toolbar.innerHTML = '<strong>' + escapeHTML(hostOf(node.url)) + '</strong><span class="iframe-tools"><button class="iframe-tool" data-action="reload" title="Reload"><svg class="icon"><use href="#i-refresh"/></svg></button><button class="iframe-tool" data-action="open" title="Open in browser"><svg class="icon"><use href="#i-external"/></svg></button></span>';
    const frame = document.createElement("iframe");
    frame.className = "website-frame";
    frame.title = node.title;
    frame.loading = "eager";
    frame.referrerPolicy = "no-referrer";
    frame.allow = "clipboard-read; clipboard-write; fullscreen; picture-in-picture";
    frame.sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";
    frame.src = node.url;
    const fallback = document.createElement("div");
    fallback.className = "frame-fallback";
    fallback.textContent = "If this page is blank, the website may block embedding. Open it in a browser tab.";
    wrap.append(toolbar, frame, fallback);
    body.replaceChildren(wrap);
    toast("Trying to load " + node.title + ". Host policy may prevent embedding.");
  }

  function openWebsite(node) {
    const anchor = document.createElement("a");
    anchor.href = node.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast("Opening " + node.title + " in a new browser tab.");
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
      description: "A website surface. Try embedding it, or open it in a browser tab.",
      x: Math.round(point.x - 190), y: Math.round(point.y - 145), w: 390, h: 300,
      z: ++zCounter, createdAt: new Date().toISOString()
    };
    nodes.push(node);
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
    if (file.size > 2 * 1024 * 1024) return toast("Workspace file is too large (maximum 2 MB).", "error");
    try {
      const data = JSON.parse(await file.text());
      if (data.schema !== "nolane-infinite-workspace" || !Array.isArray(data.nodes)) throw new Error("This file is not a Nolane workspace export.");
      const imported = data.nodes.map(validateNode).filter(Boolean).slice(0, MAX_NODES);
      if (!imported.length && data.nodes.length) throw new Error("No valid workspace items were found.");
      nodes = imported;
      selectedId = null;
      if (data.view && Number.isFinite(data.view.x) && Number.isFinite(data.view.y) && Number.isFinite(data.view.scale)) {
        view = { x: data.view.x, y: data.view.y, scale: clamp(data.view.scale, MIN_SCALE, MAX_SCALE) };
      }
      renderNodes();
      applyView();
      scheduleSave();
      toast("Imported " + nodes.length + " workspace items.");
    } catch (error) {
      toast(error.message || "Could not read that workspace file.", "error");
    }
    fileInput.value = "";
  }

  function initEvents() {
    addForm.addEventListener("submit", (event) => event.preventDefault());
    $("#addButton").addEventListener("click", () => openAddDialog("website"));
    $("#bridgeButton").addEventListener("click", () => $("#bridgeDialog").showModal());
    $("#helpButton").addEventListener("click", () => $("#helpDialog").showModal());
    $("#helpButton").addEventListener("click", () => {});
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
    $("#newSpaceBtn").addEventListener("click", () => toast("Multiple named spaces are planned for a future release."));
    $("#workspaceMenu").addEventListener("click", () => toast("This is your local personal space."));
    $$(".space-item").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.toast) toast(button.dataset.toast);
      else toast("You're already in this space.");
    }));
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
      if (event.code === "Space" && !typing) { spacePressed = true; canvas.classList.add("space-pan"); event.preventDefault(); }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) {
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
    nodes = defaultNodes();
    renderNodes();
    applyView();
    toast("Local storage could not be opened. This session will still work.", "error");
  });
  registerServiceWorker();
})();