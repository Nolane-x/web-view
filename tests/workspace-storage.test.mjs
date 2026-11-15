import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../workspace-storage.js", import.meta.url), "utf8");
const context = {};
vm.runInNewContext(source, context, { filename: "workspace-storage.js" });
const storage = context.NolaneWorkspaceStorage;
test("legacy Chrome tab bindings are discarded while the website card is preserved", () => {
  const clean = storage.sanitizeNode({id:"old-card",type:"website",title:"Research",url:"https://example.com/path",browserTabId:42,browserWindowId:7,browserSessionId:"legacy-session-identity"});
  assert.equal(clean.id,"old-card"); assert.equal(clean.title,"Research"); assert.equal(clean.url,"https://example.com/path");
  assert.equal("browserTabId" in clean,false); assert.equal("browserWindowId" in clean,false); assert.equal("browserSessionId" in clean,false);
});
test("legacy tab bindings are stripped from every workspace export", () => {
  const clean = storage.sanitizeSpaces([{id:"space",name:"Research",nodes:[{id:"old-card",type:"website",url:"https://example.com",browserTabId:9}]}]);
  assert.equal(clean[0].nodes[0].url,"https://example.com"); assert.equal("browserTabId" in clean[0].nodes[0],false);
});
