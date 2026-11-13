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
      isBookmarked: message.isBookmarked === true
    });
  }

  const api = Object.freeze({ createCommand, createNavigationCommand, normalizeSurfaceState });
  const root = typeof window !== "undefined" ? window : globalThis;
  root.NolaneNativeBridge = api;
})();
