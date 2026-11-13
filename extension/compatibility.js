(function (root) {
  "use strict";

  const SITE_RULES = [
    { category: "media", label: "Video / media", pattern: /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|netflix\.com|disneyplus\.com|primevideo\.com|spotify\.com)$/i },
    { category: "meeting", label: "Meeting / communication", pattern: /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|discord\.com)$/i },
    { category: "learning", label: "Learning / education", pattern: /(learn|learning|academy|coursera|edx\.org|khanacademy|quizlet|udemy|duolingo|classroom|youpass|school)/i },
    { category: "collaboration", label: "Collaboration / workspace", pattern: /(^|\.)(notion\.so|figma\.com|miro\.com|slack\.com|linear\.app|trello\.com|asana\.com)$/i },
    { category: "developer", label: "Developer tool", pattern: /(^|\.)(github\.com|gitlab\.com|stackoverflow\.com|vercel\.com|console\.cloud\.google\.com)$/i },
    { category: "dashboard", label: "Dashboard / admin", pattern: /(dashboard|admin|console|analytics|manage|control-panel)/i }
  ];

  function classifyUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch (_) {
      return { category: "unknown", label: "Unknown website", confidence: "none", origin: "", authFlow: false, hints: ["Open a normal HTTPS or HTTP website tab."] };
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();
    const origin = url.origin;
    const authFlow = /(^|\/)(login|log-in|signin|sign-in|oauth|authorize|authentication|sso)(\/|$)/i.test(path);
    let match = SITE_RULES.find((rule) => rule.pattern.test(host) || (rule.category === "dashboard" && rule.pattern.test(path)));
    if (!match && /(^|\/)(app|workspace|portal)(\/|$)/i.test(path)) {
      match = { category: "web-app", label: "Web application" };
    }
    const result = {
      category: match?.category || "general",
      label: match?.label || "General website",
      confidence: match ? "heuristic" : "low",
      origin,
      authFlow,
      hints: []
    };
    if (authFlow) result.hints.push("This tab appears to be on an authentication route. Do not share page URLs or credentials in diagnostic reports.");
    if (result.category === "media") result.hints.push("Some services use protected video output or render playback in a separate restricted surface; a black captured video may be a platform restriction, not a broken canvas.");
    if (result.category === "meeting") result.hints.push("Browser permission dialogs, device pickers and some meeting overlays belong to Chrome or the operating system and are not part of the captured webpage.");
    if (result.category === "learning") result.hints.push("Keep the source tab visible. For keyboard-heavy exercises, use Focus source when a page requires direct browser focus.");
    if (result.category === "collaboration" || result.category === "web-app" || result.category === "dashboard") result.hints.push("Keep the source window unminimized and avoid automatic reloads; some apps pause network or rendering when hidden.");
    return result;
  }

  function diagnose(input) {
    const state = input || {};
    const site = state.site || classifyUrl(state.url || "");
    const stage = String(state.stage || "connected");
    const message = String(state.errorMessage || state.error || "");
    const text = message.toLowerCase();
    const health = String(state.healthState || "");
    const capture = String(state.captureStatus || "");
    const video = state.videoInfo || {};
    let code = "READY";
    let severity = "info";
    let title = "Ready to stream";
    let summary = "The active tab is eligible for the Nolane live-surface workflow.";
    let actions = ["Start a live surface from the Companion popup."];

    if (/cannot access a chrome-extension:\/\/ URL of different extension/i.test(message)) {
      code = "CDP_FOREIGN_EXTENSION_FRAME";
      severity = "warning";
      title = "Chrome blocked input control";
      summary = "Chrome refused debugger attachment because this page may contain a frame or content injected by another extension. Video capture can still work independently.";
      actions = ["Keep the video-only surface and use Focus source.", "For full pointer/keyboard control, test a clean Chrome profile or temporarily disable extensions that inject page overlays."];
    } else if (!state.session && (capture === "pending" || capture === "active")) {
      code = "CAPTURE_ALREADY_ACTIVE";
      severity = "warning";
      title = "Another tool is already capturing this tab";
      summary = "Chrome reports a pending or active capture, but Nolane does not own that session.";
      actions = ["Stop the capture in the other recorder or workspace.", "Then start a new Nolane stream from this tab."];
    } else if (/already reports an active capture|already.*captur|capture.*already/i.test(text)) {
      code = "CAPTURE_ALREADY_ACTIVE";
      severity = "warning";
      title = "This tab is already being captured";
      summary = "Chrome reports an existing pending or active capture for this source tab.";
      actions = ["Stop the existing capture in Nolane or another recorder.", "Reopen the Companion and start one capture only."];
    } else if (/permission|not allowed|activeTab|user gesture|denied|cannot capture/i.test(text)) {
      code = "CAPTURE_PERMISSION";
      severity = "error";
      title = "Chrome did not grant tab capture";
      summary = "The tab may not have an activeTab grant, may not be a normal web page, or the user-initiated capture request was rejected.";
      actions = ["Open the website in a normal HTTP/HTTPS tab.", "Click the Companion toolbar action on that tab, then start streaming from its popup.", "Do not try to capture Chrome settings, extension pages or browser-owned dialogs."];
    } else if (/stream.?id|consumer tab|expired|invalid.*stream|could not start video source/i.test(text)) {
      code = "STREAM_TOKEN";
      severity = "error";
      title = "The stream could not be handed to Nolane";
      summary = "Chrome's short-lived, one-use stream token was not consumed by the designated workspace tab.";
      actions = ["Keep the Nolane workspace open and retry once.", "Refresh the workspace tab, reopen the source tab's Companion and start a new stream."];
    } else if (/decoded video frame|first frame|did not deliver/i.test(text) || (stage.includes("first decoded") && !video.width)) {
      code = "FIRST_FRAME_TIMEOUT";
      severity = "error";
      title = "Chrome opened capture but sent no decoded frame";
      summary = "The canvas did not receive a usable first video frame before the startup timeout.";
      actions = ["Keep both Chrome windows visible and unminimized.", "Check whether the source tab displays a video or restricted surface.", "Try the same page in a clean Chrome profile if another extension injects an overlay."];
    } else if (/could not decode|decode.*video|media.?element/i.test(text)) {
      code = "VIDEO_DECODE";
      severity = "error";
      title = "The captured video could not be decoded";
      summary = "The stream reached the workspace, but its video element could not decode the media.";
      actions = ["Reload the Nolane workspace and reconnect once.", "Check Chrome graphics acceleration and update the browser.", "If only protected media is black, the service may intentionally block capture."];
    } else if (/different website|origin changed|cross.?origin/i.test(text)) {
      code = "SOURCE_ORIGIN_CHANGED";
      severity = "warning";
      title = "The source website changed";
      summary = "Nolane stopped the session because the source tab navigated to a different origin.";
      actions = ["Return to the intended website and start a new live surface."];
    } else if (capture === "error" || capture === "stopped" || video.trackReadyState === "ended") {
      code = "CAPTURE_ENDED";
      severity = "error";
      title = "Chrome ended the capture track";
      summary = "The source capture itself has ended. Reattaching the same MediaStream cannot restore an ended track.";
      actions = ["Start a new capture from the active source tab using the Companion.", "If Chrome stops capture repeatedly, close other capture tools and inspect chrome://extensions."];
    } else if (video.trackMuted || health === "muted") {
      code = "CAPTURE_MUTED";
      severity = "warning";
      title = "Chrome temporarily muted the captured track";
      summary = "The video track is still present but currently marked muted by Chrome.";
      actions = ["Keep the source tab visible and wait for an unmute event.", "Use Focus source and verify the original page is still rendering."];
    } else if (health === "stalled" || health === "recovering" || (video.width === 0 && state.acknowledged)) {
      code = health === "recovering" ? "VIDEO_RECOVERING" : "VIDEO_NO_NEW_FRAMES";
      severity = "warning";
      title = health === "recovering" ? "Video recovery is in progress" : "No new video frames are arriving";
      summary = "The capture session exists, but the workspace has not received a fresh compositor-presented frame recently.";
      actions = ["Use Refresh video to reattach the existing stream.", "Check the source tab for paused playback, hidden dialogs or throttled rendering.", "If the capture track has ended, start a new stream rather than refreshing the video element."];
    } else if (health === "paused") {
      code = "WORKSPACE_HIDDEN";
      severity = "info";
      title = "Video monitoring is paused";
      summary = "The workspace or live card is not currently visible, so frame health cannot be judged reliably.";
      actions = ["Bring the Nolane window and live card into view."];
    } else if (!state.session) {
      code = "NOT_STREAMING";
      severity = "info";
      title = "This website is not streaming yet";
      summary = "The current tab has no active Nolane live surface.";
      actions = ["Open the Companion on this website tab and choose Stream this tab to Nolane."];
    } else if (health === "healthy" || (video.width > 0 && capture === "active")) {
      code = "READY";
      severity = "success";
      title = "Live surface appears healthy";
      summary = "Chrome reports an active capture and the workspace has decoded video frames.";
      actions = ["Keep both windows unminimized for visibility-sensitive websites."];
    } else {
      code = "CHECK_REQUIRED";
      severity = "info";
      title = "More evidence is needed";
      summary = "The current signals do not identify a single failure. Collect a fresh compatibility report after reproducing the issue.";
      actions = ["Reproduce the problem once, then copy the compatibility report.", "Do not repeatedly restart capture; that can create duplicate capture state."];
    }

    const hints = [...(site.hints || [])];
    if (site.authFlow) hints.push("Authentication-related pages can contain short-lived tokens in their URLs; Nolane records only the origin.");
    return {
      code,
      severity,
      title,
      summary,
      stage,
      category: site.category,
      categoryLabel: site.label,
      confidence: site.confidence,
      actions,
      hints
    };
  }

  function assessSession(session) {
    const state = session || {};
    const video = state.videoInfo || {};
    const health = String(state.healthState || "checking");
    if (state.captureStatus === "error" || state.captureStatus === "stopped" || video.trackReadyState === "ended") {
      return { action: "restart-capture", label: "Start a new capture", reason: "The original Chrome capture track has ended." };
    }
    if (health === "stalled" && video.trackReadyState === "live" && !video.trackMuted) {
      return { action: "refresh-video", label: "Refresh video", reason: "The existing track is live, so a local presentation refresh is safe to try." };
    }
    if (video.trackMuted || health === "muted" || health === "paused") {
      return { action: "focus-source", label: "Focus source", reason: "The source or workspace needs attention before refreshing the video." };
    }
    if (health === "healthy") return { action: "none", label: "Healthy", reason: "New video frames are arriving." };
    return { action: "inspect", label: "Inspect status", reason: "More capture and video evidence is needed." };
  }

  root.NolaneCompatibility = Object.freeze({ classifyUrl, diagnose, assessSession });
})(globalThis);
