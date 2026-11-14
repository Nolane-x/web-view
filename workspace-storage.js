(() => {
  "use strict";

  function sanitizeNode(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const { transientUrl, ...persistedNode } = node;
    return persistedNode;
  }

  function sanitizeNodes(nodes) {
    return Array.isArray(nodes) ? nodes.map(sanitizeNode) : [];
  }

  function sanitizeSpaces(spaces) {
    if (!Array.isArray(spaces)) return [];
    return spaces
      .filter((space) => space && typeof space === "object" && !Array.isArray(space))
      .map((space) => ({ ...space, nodes: sanitizeNodes(space.nodes) }));
  }

  const api = Object.freeze({ sanitizeNode, sanitizeNodes, sanitizeSpaces });
  const root = typeof window !== "undefined" ? window : globalThis;
  root.NolaneWorkspaceStorage = api;
})();
