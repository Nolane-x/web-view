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


test("world coordinates preserve large valid positions beyond the former 100,000-unit clamp", () => {
  const { normalizeWorldCoordinate } = require("../spatial-index.js");
  assert.equal(normalizeWorldCoordinate(500000, 0, 8_000_000), 500000);
  assert.equal(normalizeWorldCoordinate(-750000, 0, 8_000_000), -750000);
});

test("world coordinates clamp finite values and replace non-finite values with a safe fallback", () => {
  const { normalizeWorldCoordinate } = require("../spatial-index.js");
  assert.equal(normalizeWorldCoordinate(2_000_000_000, 17, 8_000_000), 8_000_000);
  assert.equal(normalizeWorldCoordinate(-2_000_000_000, -17, 8_000_000), -8_000_000);
  assert.equal(normalizeWorldCoordinate(Number.POSITIVE_INFINITY, 42, 8_000_000), 42);
  assert.equal(normalizeWorldCoordinate(Number.NaN, -42, 8_000_000), -42);
  assert.equal(normalizeWorldCoordinate(null, 19, 8_000_000), 19);
  assert.equal(normalizeWorldCoordinate("", -19, 8_000_000), -19);
});

test("camera translations use the normalized scale-aware world-coordinate budget", () => {
  const { normalizeViewState } = require("../spatial-index.js");
  const options = {
    defaultX: 25, defaultY: 0, defaultScale: 1,
    minScale: 0.25, maxScale: 2.2, maxWorldCoordinate: 8_000_000
  };
  assert.deepEqual(normalizeViewState({ x: -500000, y: 700000, scale: 1 }, options), {
    x: -500000, y: 700000, scale: 1
  });
  assert.deepEqual(normalizeViewState({ x: 9_000_000_000, y: -9_000_000_000, scale: 0.5 }, options), {
    x: 4_000_000, y: -4_000_000, scale: 0.5
  });
});

test("camera scale is bounded and invalid camera values receive deterministic defaults", () => {
  const { normalizeViewState } = require("../spatial-index.js");
  const options = {
    defaultX: 25, defaultY: 7, defaultScale: 1,
    minScale: 0.25, maxScale: 2.2, maxWorldCoordinate: 8_000_000
  };
  assert.deepEqual(normalizeViewState({ x: Number.NaN, y: Number.POSITIVE_INFINITY, scale: 99 }, options), {
    x: 25, y: 7, scale: 2.2
  });
  assert.deepEqual(normalizeViewState({ x: 500, y: -500, scale: 0.01 }, options), {
    x: 500, y: -500, scale: 0.25
  });
  assert.deepEqual(normalizeViewState(null, options), {
    x: 25, y: 7, scale: 1
  });
  assert.deepEqual(normalizeViewState({ x: null, y: "", scale: null }, options), {
    x: 25, y: 7, scale: 1
  });
});


test("maximum camera zoom stays inside the practical Chromium CSS length range", () => {
  const { normalizeViewState } = require("../spatial-index.js");
  const options = {
    defaultX: 25, defaultY: 0, defaultScale: 1,
    minScale: 0.25, maxScale: 2.2, maxWorldCoordinate: 8_000_000
  };
  const view = normalizeViewState({ x: 100_000_000, y: -100_000_000, scale: 2.2 }, options);
  assert.deepEqual(view, { x: 17_600_000, y: -17_600_000, scale: 2.2 });
  assert.ok(Math.abs(view.x) < 33_554_429);
  assert.ok(Math.abs(view.y) < 33_554_429);
});


test("viewport origin rebasing preserves exact screen positions for large world coordinates", () => {
  const { computeRenderOrigin, rebasePoint, createRebasedTransform } = require("../spatial-index.js");
  const view = { x: -6_250_320, y: -3_000_160, scale: 1.25 };
  const viewport = { width: 1440, height: 900 };
  const origin = computeRenderOrigin(view, viewport, 4096);
  const point = { x: 5_000_000, y: 2_400_000 };
  const local = rebasePoint(point, origin);
  const transform = createRebasedTransform(view, origin);
  const logicalScreen = {
    x: point.x * view.scale + view.x,
    y: point.y * view.scale + view.y
  };
  const rebasedScreen = {
    x: local.x * transform.scale + transform.x,
    y: local.y * transform.scale + transform.y
  };
  assert.ok(Math.abs(rebasedScreen.x - logicalScreen.x) < 1e-7);
  assert.ok(Math.abs(rebasedScreen.y - logicalScreen.y) < 1e-7);
  assert.ok(Math.abs(local.x) < 8192);
  assert.ok(Math.abs(local.y) < 8192);
});

test("viewport origin rebasing remains stable across negative coordinates and invalid inputs", () => {
  const { computeRenderOrigin, rebasePoint, createRebasedTransform } = require("../spatial-index.js");
  const view = { x: 1_250_000, y: 2_500_000, scale: 0.5 };
  const origin = computeRenderOrigin(view, { width: 1280, height: 720 }, 2048);
  assert.ok(origin.x < 0);
  assert.ok(origin.y < 0);
  assert.deepEqual(rebasePoint({ x: -2_500_000, y: -5_000_000 }, origin), {
    x: -2_500_000 - origin.x,
    y: -5_000_000 - origin.y
  });
  assert.deepEqual(computeRenderOrigin({ x: NaN, y: 0, scale: 1 }, { width: 800, height: 600 }), {
    x: 0, y: 0
  });
  assert.deepEqual(rebasePoint({ x: Infinity, y: 1 }, origin), { x: 0, y: 0 });
  assert.deepEqual(createRebasedTransform({ x: 0, y: 0, scale: 0 }, origin), {
    x: 0, y: 0, scale: 1
  });
});

test("spatial index keeps exact viewport query results across a 15,000-card workspace", () => {
  const index = new SpatialIndex(640);
  const nodes = Array.from({ length: 15000 }, (_, i) => ({
    id: "stress-" + i,
    x: (i % 250) * 720 - 90000,
    y: Math.floor(i / 250) * 480 - 30000,
    w: 220,
    h: 180,
    z: i
  }));
  index.rebuild(nodes);
  assert.equal(index.size, 15000);

  for (let queryIndex = 0; queryIndex < 60; queryIndex += 1) {
    const target = nodes[(queryIndex * 251) % nodes.length];
    const query = { x: target.x - 40, y: target.y - 30, w: 320, h: 260 };
    const expected = nodes.filter(item =>
      item.x < query.x + query.w && item.x + item.w > query.x &&
      item.y < query.y + query.h && item.y + item.h > query.y
    ).map(item => item.id).sort();
    const actual = index.query(query).map(item => item.id).sort();
    assert.deepEqual(actual, expected);
  }

  const moved = nodes.slice(0, 100);
  for (const item of moved) {
    item.x += 250000;
    item.y -= 180000;
    assert.equal(index.upsert(item), true);
  }
  assert.equal(index.query({ x: -100000, y: -30000, w: 1000, h: 1000 })
    .some(item => moved.includes(item)), false);
});


test("origin rebasing keeps pinned edge cards inside bounded CSS coordinates at both world limits", () => {
  const { computeRenderOrigin, rebasePoint, createRebasedTransform } = require("../spatial-index.js");
  const cases = [
    { view: { x: -17_600_000, y: -17_600_000, scale: 2.2 }, point: { x: -8_000_000, y: -8_000_000 } },
    { view: { x: 17_600_000, y: 17_600_000, scale: 2.2 }, point: { x: 8_000_000, y: 8_000_000 } }
  ];
  for (const entry of cases) {
    const origin = computeRenderOrigin(entry.view, { width: 1440, height: 900 }, 4096);
    const local = rebasePoint(entry.point, origin);
    const transform = createRebasedTransform(entry.view, origin);
    const logicalX = entry.point.x * entry.view.scale + entry.view.x;
    const logicalY = entry.point.y * entry.view.scale + entry.view.y;
    const rebasedX = local.x * transform.scale + transform.x;
    const rebasedY = local.y * transform.scale + transform.y;
    assert.ok(Math.abs(rebasedX - logicalX) < 1e-6);
    assert.ok(Math.abs(rebasedY - logicalY) < 1e-6);
    assert.ok(Math.abs(local.x) < 16_100_000);
    assert.ok(Math.abs(local.y) < 16_100_000);
    assert.ok(Math.abs(transform.x) < 20_000);
    assert.ok(Math.abs(transform.y) < 20_000);
  }
});


test("broad viewport queries use the coarse grid instead of scanning every entry", () => {
  const index = new SpatialIndex(128);
  const nodes = Array.from({ length: 12000 }, (_, i) => ({
    id: "coarse-" + i,
    x: (i % 300) * 400 - 60000,
    y: Math.floor(i / 300) * 400 - 8000,
    w: 220,
    h: 180
  }));
  const outside = { id: "coarse-outside", x: 900000, y: 900000, w: 220, h: 180 };
  index.rebuild([...nodes, outside]);

  const query = { x: -100000, y: -100000, w: 500000, h: 500000 };
  const expected = [...nodes, outside].filter(item =>
    item.x < query.x + query.w && item.x + item.w > query.x &&
    item.y < query.y + query.h && item.y + item.h > query.y
  ).map(item => item.id).sort();

  // The fine grid covers more than MAX_CELLS_PER_QUERY, while the 64× coarse
  // grid covers fewer cells. A full-entry fallback would throw here.
  index.entries.keys = () => { throw new Error("Broad query unexpectedly scanned every entry."); };
  const actual = index.query(query).map(item => item.id).sort();
  assert.deepEqual(actual, expected);
});

test("coarse overflow entries remain discoverable and removable at every query scale", () => {
  const index = new SpatialIndex(128);
  const huge = { id: "coarse-overflow", x: -2_000_000, y: -2_000_000, w: 4_000_000, h: 4_000_000 };
  const small = { id: "coarse-small", x: 3_000_000, y: 3_000_000, w: 120, h: 120 };
  index.rebuild([huge, small]);
  assert.deepEqual(index.query({ x: -100, y: -100, w: 200, h: 200 }).map(item => item.id), ["coarse-overflow"]);
  assert.deepEqual(index.query({ x: -2_100_000, y: -2_100_000, w: 4_200_000, h: 4_200_000 })
    .map(item => item.id).sort(), ["coarse-overflow"]);
  assert.equal(index.remove(huge.id), true);
  assert.deepEqual(index.query({ x: -100, y: -100, w: 200, h: 200 }), []);
  assert.deepEqual(index.query({ x: 2_999_900, y: 2_999_900, w: 400, h: 400 }).map(item => item.id), ["coarse-small"]);
});


test("upsert moves entries across fine and coarse cells without leaving stale candidates", () => {
  const index = new SpatialIndex(128);
  const moving = { id: "moving-between-grids", x: -120, y: -120, w: 80, h: 80 };
  index.upsert(moving);
  assert.deepEqual(index.query({ x: -160, y: -160, w: 160, h: 160 }).map(item => item.id), [moving.id]);

  moving.x = 2_000_000;
  moving.y = -2_000_000;
  assert.equal(index.upsert(moving), true);
  assert.deepEqual(index.query({ x: -160, y: -160, w: 160, h: 160 }), []);
  assert.deepEqual(index.query({ x: 1_999_900, y: -2_000_100, w: 300, h: 300 }).map(item => item.id), [moving.id]);

  moving.x = -3_000_000;
  moving.y = -3_000_000;
  moving.w = 6_000_000;
  moving.h = 6_000_000;
  index.upsert(moving);
  assert.deepEqual(index.query({ x: -100, y: -100, w: 200, h: 200 }).map(item => item.id), [moving.id]);

  moving.x = 700_000;
  moving.y = 700_000;
  moving.w = 80;
  moving.h = 80;
  index.upsert(moving);
  assert.deepEqual(index.query({ x: -100, y: -100, w: 200, h: 200 }), []);
  assert.deepEqual(index.query({ x: 699_900, y: 699_900, w: 300, h: 300 }).map(item => item.id), [moving.id]);
  assert.equal(index.remove(moving.id), true);
  assert.equal(index.size, 0);
});
