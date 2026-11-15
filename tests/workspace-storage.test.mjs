import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../workspace-storage.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, Object, Array }, { filename: "workspace-storage.js" });
const storage = window.NolaneWorkspaceStorage;

test("private navigation addresses are removed from a node without mutating live state", () => {
  const liveNode = {
    id: "private-card",
    type: "website",
    url: "https://example.com/regular-entry",
    privateMode: true,
    transientUrl: "https://example.com/private-search?q=secret"
  };
  const saved = storage.sanitizeNode(liveNode);
  assert.equal(saved.url, "https://example.com/regular-entry");
  assert.equal(saved.privateMode, true);
  assert.equal(Object.hasOwn(saved, "transientUrl"), false);
  assert.equal(liveNode.transientUrl, "https://example.com/private-search?q=secret");
});

test("active workspace persistence sanitizes every website card", () => {
  const saved = storage.sanitizeNodes([
    { id: "regular", url: "https://example.com", privateMode: false },
    { id: "private", url: "https://example.org/start", privateMode: true, transientUrl: "https://example.org/private" }
  ]);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].url, "https://example.com");
  assert.equal(saved[1].url, "https://example.org/start");
  assert.equal(Object.hasOwn(saved[1], "transientUrl"), false);
});

test("workspace export sanitizes every space, including inactive workspaces", () => {
  const sourceSpaces = [
    { id: "one", name: "One", view: { x: 1 }, nodes: [{ id: "a", transientUrl: "https://private.example/a" }] },
    { id: "two", name: "Two", nodes: [{ id: "b", privateMode: true, transientUrl: "https://private.example/b" }] }
  ];
  const savedSpaces = storage.sanitizeSpaces(sourceSpaces);
  assert.equal(savedSpaces.length, 2);
  assert.equal(savedSpaces[0].name, "One");
  assert.equal(savedSpaces[0].nodes[0].id, "a");
  assert.equal(Object.hasOwn(savedSpaces[0].nodes[0], "transientUrl"), false);
  assert.equal(Object.hasOwn(savedSpaces[1].nodes[0], "transientUrl"), false);
  assert.equal(sourceSpaces[1].nodes[0].transientUrl, "https://private.example/b");
});

test("malformed collection input produces an empty safe collection", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(storage.sanitizeNodes(null))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.sanitizeSpaces({}))), []);
});

test("legacy Chrome tab bindings are discarded while the website card is preserved", () => {
  const clean = storage.sanitizeNode({
    id: "old-card", type: "website", title: "Research", url: "https://example.com/path",
    browserTabId: 42, browserWindowId: 7, browserSessionId: "legacy-session-identity"
  });
  assert.equal(clean.id, "old-card");
  assert.equal(clean.title, "Research");
  assert.equal(clean.url, "https://example.com/path");
  assert.equal("browserTabId" in clean, false);
  assert.equal("browserWindowId" in clean, false);
  assert.equal("browserSessionId" in clean, false);
});

test("legacy tab bindings are stripped from every workspace export", () => {
  const clean = storage.sanitizeSpaces([{
    id: "space", name: "Research",
    nodes: [{ id: "old-card", type: "website", url: "https://example.com", browserTabId: 9 }]
  }]);
  assert.equal(clean[0].nodes[0].url, "https://example.com");
  assert.equal("browserTabId" in clean[0].nodes[0], false);
});
