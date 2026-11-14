(() => {
  "use strict";

  const ACTIONS = new Set(["back", "forward", "reload", "stop", "toggle-mute", "toggle-bookmark", "open-external"]);
  const STATES = new Set(["ready", "loading", "suspended", "limit", "error"]);

  function createCommand(surfaceId, action) {
    if (typeof surfaceId !== "string" || !surfaceId.trim() || surfaceId.length > 128) return null;
    if (!ACTIONS.has(action)) return null;
    return Object.freeze({
      type: "nolane.surface.command",
      protocol: 1,
      id: surfaceId,
      action
    });
  }

  function createNavigationCommand(surfaceId, rawUrl) {
    if (typeof surfaceId !== "string" || !surfaceId.trim() || surfaceId.length > 128) return null;
    if (typeof rawUrl !== "string" || !rawUrl.trim() || rawUrl.length > 4096) return null;
    let value = rawUrl.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
    try {
      const parsed = new URL(value);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
      return Object.freeze({
        type: "nolane.surface.command",
        protocol: 1,
        id: surfaceId,
        action: "navigate",
        url: parsed.href
      });
    } catch (_) {
      return null;
    }
  }

  function normalizeProfileName(value) {
    if (typeof value !== "string") return null;
    const clean = value.trim();
    if (!clean || clean.length > 64 || !/^[A-Za-z0-9 _-]+$/.test(clean) || /[. ]$/.test(clean)) return null;
    return clean;
  }

  function summarizeProfileUsage(spaces) {
    const usage = new Map();
    if (!Array.isArray(spaces)) return [];
    for (const space of spaces) {
      if (!space || !Array.isArray(space.nodes)) continue;
      for (const node of space.nodes) {
        if (!node || node.type !== "website") continue;
        const name = normalizeProfileName(node.browserProfile) || "";
        usage.set(name, (usage.get(name) || 0) + 1);
      }
    }
    return [...usage.entries()]
      .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
      .map(([name, count]) => ({ name, count }));
  }

  function normalizeSurfaceState(message) {
    if (!message || typeof message !== "object" || message.type !== "nolane.native.surface") return null;
    if (typeof message.id !== "string" || !message.id.trim() || message.id.length > 128) return null;
    const state = STATES.has(message.state) ? message.state : "error";
    let url = null;
    if (typeof message.url === "string" && message.url.length <= 4096) {
      try {
        const parsed = new URL(message.url);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password) {
          url = parsed.href;
        }
      } catch (_) {}
    }
    return Object.freeze({
      id: message.id,
      state,
      detail: String(message.detail || "").slice(0, 240),
      url,
      title: String(message.title || "").slice(0, 160),
      canGoBack: message.canGoBack === true,
      canGoForward: message.canGoForward === true,
      isMuted: message.isMuted === true,
      isPlayingAudio: message.isPlayingAudio === true,
      isBookmarked: message.isBookmarked === true,
      isPrivateMode: typeof message.isPrivateMode === "boolean" ? message.isPrivateMode : null,
      profileName: typeof message.profileName === "string"
        ? (message.profileName === "" ? "" : normalizeProfileName(message.profileName))
        : null
    });
  }

  const api = Object.freeze({ createCommand, createNavigationCommand, normalizeProfileName, summarizeProfileUsage, normalizeSurfaceState });
  const root = typeof window !== "undefined" ? window : globalThis;
  root.NolaneNativeBridge = api;
})();
