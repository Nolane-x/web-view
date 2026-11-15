import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { SpatialIndex } = require("../spatial-index.js");

const SIZES = [2000, 10000, 50000];
const QUERY_COUNT = 250;
const round = value => Math.round(value * 100) / 100;

function makeDataset(size) {
  return Array.from({ length: size }, (_, index) => ({
    id: "bench-" + index,
    x: (index % 1000) * 8000 - 4_000_000,
    y: Math.floor(index / 1000) * 8000 - 200_000,
    w: 360,
    h: 280,
    z: index
  }));
}

function intersects(item, rect) {
  return item.x < rect.x + rect.w && item.x + item.w > rect.x &&
    item.y < rect.y + rect.h && item.y + item.h > rect.y;
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] || 0;
}

for (const size of SIZES) {
  const nodes = makeDataset(size);
  const index = new SpatialIndex(640);
  const buildStart = performance.now();
  index.rebuild(nodes);
  const buildMs = performance.now() - buildStart;

  const queryTimes = [];
  let returned = 0;
  let correctnessChecks = 0;
  for (let queryNumber = 0; queryNumber < QUERY_COUNT; queryNumber += 1) {
    const target = nodes[(queryNumber * 197) % nodes.length];
    const query = {
      x: target.x - 220,
      y: target.y - 160,
      w: 1440,
      h: 960
    };
    const start = performance.now();
    const result = index.query(query);
    queryTimes.push(performance.now() - start);
    returned += result.length;

    if (queryNumber < 25) {
      const expected = nodes.filter(item => intersects(item, query)).map(item => item.id).sort();
      const actual = result.map(item => item.id).sort();
      if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i])) {
        throw new Error("SpatialIndex returned an incorrect result at size " + size + ", query " + queryNumber);
      }
      correctnessChecks += 1;
    }
  }

  const broadQuery = { x: -250_000, y: -250_000, w: 500_000, h: 500_000 };
  const broadQueryTimes = [];
  let broadResultCount = 0;
  for (let queryNumber = 0; queryNumber < 80; queryNumber += 1) {
    const start = performance.now();
    const result = index.query(broadQuery);
    broadQueryTimes.push(performance.now() - start);
    broadResultCount += result.length;
    if (queryNumber < 5) {
      const expected = nodes.filter(item => intersects(item, broadQuery)).map(item => item.id).sort();
      const actual = result.map(item => item.id).sort();
      if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i])) {
        throw new Error("Coarse viewport query returned an incorrect result at size " + size);
      }
    }
  }

  const moved = nodes.slice(0, Math.min(500, nodes.length));
  const updateStart = performance.now();
  for (const item of moved) {
    item.x += 300000;
    item.y -= 200000;
    index.upsert(item);
  }
  const updateMs = performance.now() - updateStart;

  console.log(JSON.stringify({
    nodes: size,
    buildMs: round(buildMs),
    queryCount: QUERY_COUNT,
    queryP50Ms: round(percentile(queryTimes, 0.5)),
    queryP95Ms: round(percentile(queryTimes, 0.95)),
    averageResultsPerQuery: round(returned / QUERY_COUNT),
    broadQueryCount: broadQueryTimes.length,
    broadQueryP50Ms: round(percentile(broadQueryTimes, 0.5)),
    broadQueryP95Ms: round(percentile(broadQueryTimes, 0.95)),
    averageBroadResults: round(broadResultCount / broadQueryTimes.length),
    updatedNodes: moved.length,
    updateMs: round(updateMs),
    bruteForceCorrectnessChecks: correctnessChecks
  }));
}
