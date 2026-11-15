import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SpatialIndex } = require("../spatial-index.js");

test("queries negative coordinates and exact grid-cell boundaries", () => {
  const index = new SpatialIndex(100);
  const left = { id: "left", x: -100, y: -20, w: 100, h: 40 };
  const right = { id: "right", x: 0, y: -20, w: 100, h: 40 };
  index.rebuild([left, right]);
  assert.deepEqual(index.query({ x: -100, y: -20, w: 100, h: 40 }).map(item => item.id), ["left"]);
  assert.deepEqual(index.query({ x: 0, y: -20, w: 100, h: 40 }).map(item => item.id), ["right"]);
  assert.deepEqual(index.query({ x: 100, y: -20, w: 1, h: 40 }), []);
});

test("upsert moves an item and remove releases its previous cells", () => {
  const index = new SpatialIndex(128);
  const item = { id: "moving", x: 0, y: 0, w: 80, h: 80 };
  index.upsert(item);
  assert.equal(index.query({ x: 0, y: 0, w: 128, h: 128 }).length, 1);
  item.x = 2048;
  item.y = -1024;
  index.upsert(item);
  assert.equal(index.query({ x: 0, y: 0, w: 128, h: 128 }).length, 0);
  assert.equal(index.query({ x: 2048, y: -1024, w: 128, h: 128 })[0], item);
  assert.equal(index.remove(item.id), true);
  assert.equal(index.size, 0);
});

test("large cards use a bounded overflow bucket", () => {
  const index = new SpatialIndex(64);
  const large = { id: "large", x: -10000, y: -10000, w: 50000, h: 50000 };
  const small = { id: "small", x: 100000, y: 100000, w: 10, h: 10 };
  index.rebuild([large, small]);
  assert.deepEqual(index.query({ x: 20000, y: 20000, w: 10, h: 10 }).map(item => item.id), ["large"]);
  assert.deepEqual(index.query({ x: 100000, y: 100000, w: 10, h: 10 }).map(item => item.id), ["small"]);
});

test("invalid geometry is rejected and duplicate IDs replace previous entries", () => {
  const index = new SpatialIndex();
  assert.equal(index.upsert({ id: "bad", x: 0, y: 0, w: 0, h: 10 }), false);
  assert.equal(index.upsert({ id: "valid", x: 0, y: 0, w: 100, h: 100 }), true);
  const replacement = { id: "valid", x: 2000, y: 2000, w: 50, h: 50 };
  assert.equal(index.upsert(replacement), true);
  assert.equal(index.size, 1);
  assert.deepEqual(index.query({ x: 0, y: 0, w: 100, h: 100 }), []);
  assert.equal(index.query({ x: 2000, y: 2000, w: 50, h: 50 })[0], replacement);
});

test("randomized queries match a brute-force geometry oracle", () => {
  const index = new SpatialIndex(256);
  const items = [];
  let seed = 0x6d2b79f5;
  const random = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) | 0;
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 700; i += 1) items.push({
    id: "n" + i,
    x: Math.floor(random() * 12000) - 6000,
    y: Math.floor(random() * 12000) - 6000,
    w: 30 + Math.floor(random() * 1700),
    h: 30 + Math.floor(random() * 1100)
  });
  index.rebuild(items);
  for (let i = 0; i < 250; i += 1) {
    const query = {
      x: Math.floor(random() * 12000) - 6000,
      y: Math.floor(random() * 12000) - 6000,
      w: 100 + Math.floor(random() * 2400),
      h: 100 + Math.floor(random() * 1800)
    };
    const expected = items.filter(item =>
      item.x < query.x + query.w && item.x + item.w > query.x &&
      item.y < query.y + query.h && item.y + item.h > query.y
    ).map(item => item.id).sort();
    const actual = index.query(query).map(item => item.id).sort();
    assert.deepEqual(actual, expected, "query " + i);
  }
});

test("invalid query rectangles return empty results without mutating the index", () => {
  const index = new SpatialIndex();
  index.upsert({ id: "one", x: 0, y: 0, w: 10, h: 10 });
  assert.deepEqual(index.query({ x: 0, y: 0, w: -1, h: 10 }), []);
  assert.deepEqual(index.query({ x: Number.NaN, y: 0, w: 10, h: 10 }), []);
  assert.equal(index.size, 1);
});


test("viewport queries stay selective across a full 2,000-item space", () => {
  const index = new SpatialIndex(640);
  const items = [];
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < 50; column += 1) {
      items.push({
        id: "grid-" + row + "-" + column,
        x: column * 900,
        y: row * 900,
        w: 360,
        h: 280
      });
    }
  }
  index.rebuild(items);
  const visible = index.query({ x: 18000, y: 18000, w: 1920, h: 1080 });
  assert.equal(index.size, 2000);
  assert.equal(visible.length, 6);
  assert.ok(visible.length / index.size < 0.01,
    "a normal viewport should not mount even one percent of a maximum-sized space");
});


test("get returns the current item after upsert and is empty after removal", () => {
  const index = new SpatialIndex();
  const first = { id: "lookup", x: 0, y: 0, w: 10, h: 10 };
  index.upsert(first);
  assert.equal(index.get("lookup"), first);
  const replacement = { id: "lookup", x: 100, y: 100, w: 20, h: 20 };
  index.upsert(replacement);
  assert.equal(index.get("lookup"), replacement);
  index.remove("lookup");
  assert.equal(index.get("lookup"), undefined);
});


test("native working-set ranking selects topmost cards from a 2,000-card overlap without mutating source order", () => {
  const { sortByZIndex } = require("../spatial-index.js");
  const items = Array.from({ length: 2000 }, (_, index) => ({
    id: "overlap-" + index,
    x: 0, y: 0, w: 390, h: 300,
    z: index + 1
  }));
  const originalFirst = items[0];
  const ranked = sortByZIndex(items);
  assert.equal(ranked.length, 2000);
  assert.deepEqual(ranked.slice(0, 4).map(item => item.id), [
    "overlap-1999", "overlap-1998", "overlap-1997", "overlap-1996"
  ]);
  assert.equal(items[0], originalFirst);
  assert.equal(items[0].id, "overlap-0");
  assert.deepEqual(sortByZIndex(null), []);
});


test("search result cycling advances, reverses and wraps without an empty-list index", () => {
  const { cycleIndex } = require("../spatial-index.js");
  assert.equal(cycleIndex(-1, 4, false), 0);
  assert.equal(cycleIndex(-1, 4, true), 3);
  assert.equal(cycleIndex(0, 4, true), 3);
  assert.equal(cycleIndex(3, 4, false), 0);
  assert.equal(cycleIndex(1, 4, false), 2);
  assert.equal(cycleIndex(2, 4, true), 1);
  assert.equal(cycleIndex(0, 0, false), -1);
  assert.equal(cycleIndex(0, -2, true), -1);
});


test("workspace IDs are safe, unique and retained in first-occurrence order", () => {
  const { claimUniqueId } = require("../spatial-index.js");
  const used = new Set();
  let generated = 0;
  const generate = () => "generated-" + (++generated);
  assert.equal(claimUniqueId("stable-id", used, generate), "stable-id");
  assert.equal(claimUniqueId("stable-id", used, generate), "generated-1");
  assert.equal(claimUniqueId("../unsafe", used, generate), "generated-2");
  assert.equal(claimUniqueId("x".repeat(81), used, generate), "generated-3");
  assert.equal(claimUniqueId("other", used, generate), "other");
  assert.equal(used.size, 5);
});


test("extreme but representable world coordinates use overflow lookup without unsafe cell loops", () => {
  const index = new SpatialIndex(128);
  const huge = {
    id: "huge-coordinate",
    x: Number.MAX_SAFE_INTEGER * 1000,
    y: -Number.MAX_SAFE_INTEGER * 1000,
    w: 4096,
    h: 4096
  };
  assert.equal(index.upsert(huge), true);
  assert.equal(index.get(huge.id), huge);
  assert.deepEqual(index.query({
    x: huge.x, y: huge.y, w: huge.w, h: huge.h
  }).map(item => item.id), ["huge-coordinate"]);
});

test("rectangles whose extent disappears at floating-point precision are rejected", () => {
  const index = new SpatialIndex(128);
  assert.equal(index.upsert({
    id: "collapsed",
    x: 1e300, y: 1e300, w: 1, h: 1
  }), false);
  assert.equal(index.size, 0);
});

test("very broad safe viewport queries fall back to exact rectangle filtering", () => {
  const index = new SpatialIndex(128);
  const near = { id: "near", x: 0, y: 0, w: 100, h: 100 };
  const far = { id: "far", x: 500000, y: 500000, w: 100, h: 100 };
  index.rebuild([near, far]);
  assert.deepEqual(index.query({ x: -100000, y: -100000, w: 800000, h: 800000 })
    .map(item => item.id).sort(), ["far", "near"]);
});
