(() => {
  "use strict";
  const DEFAULT_CELL_SIZE = 640;
  const MAX_CELLS_PER_ITEM = 256;
  const MAX_CELLS_PER_QUERY = 4096;

  function normalizeRect(rect) {
    if (!rect || typeof rect !== "object") return null;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.w ?? rect.width);
    const height = Number(rect.h ?? rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    const right = x + width;
    const bottom = y + height;
    // At very large magnitudes IEEE-754 may round x + width back to x.
    if (!Number.isFinite(right) || !Number.isFinite(bottom) || right <= x || bottom <= y) return null;
    return { x, y, w: width, h: height, right, bottom };
  }

  function normalizeWorldCoordinate(value, fallback = 0, maxAbs = 8_000_000) {
    const requestedLimit = Number(maxAbs);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, Number.MAX_SAFE_INTEGER)
      : 8_000_000;
    const requestedFallback = fallback == null || (typeof fallback === "string" && !fallback.trim())
      ? Number.NaN
      : Number(fallback);
    const safeFallback = Number.isFinite(requestedFallback) ? requestedFallback : 0;
    const numericValue = value == null || (typeof value === "string" && !value.trim())
      ? Number.NaN
      : Number(value);
    const normalized = Number.isFinite(numericValue) ? numericValue : safeFallback;
    return Math.max(-limit, Math.min(limit, normalized));
  }

  function normalizeViewState(value, options = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const settings = options && typeof options === "object" ? options : {};
    const requestedMinScale = Number(settings.minScale);
    const minScale = Number.isFinite(requestedMinScale) && requestedMinScale > 0 ? requestedMinScale : 0.25;
    const requestedMaxScale = Number(settings.maxScale);
    const maxScale = Number.isFinite(requestedMaxScale) && requestedMaxScale >= minScale
      ? requestedMaxScale
      : Math.max(minScale, 2.2);
    const requestedDefaultScale = Number(settings.defaultScale);
    const defaultScale = Number.isFinite(requestedDefaultScale)
      ? Math.max(minScale, Math.min(maxScale, requestedDefaultScale))
      : Math.max(minScale, Math.min(maxScale, 1));
    const requestedScale = source.scale == null || (typeof source.scale === "string" && !source.scale.trim())
      ? Number.NaN
      : Number(source.scale);
    const scale = Number.isFinite(requestedScale)
      ? Math.max(minScale, Math.min(maxScale, requestedScale))
      : defaultScale;

    const requestedWorldLimit = Number(settings.maxWorldCoordinate);
    const maxWorldCoordinate = Number.isFinite(requestedWorldLimit) && requestedWorldLimit > 0
      ? Math.min(requestedWorldLimit, Number.MAX_SAFE_INTEGER)
      : 8_000_000;
    // x/y are CSS-pixel translations. Dividing them by scale yields the world's
    // top-left coordinate, so scale the translation budget with the camera.
    const maxTranslation = Math.min(Number.MAX_SAFE_INTEGER, maxWorldCoordinate * scale);
    const requestedDefaultX = Number(settings.defaultX);
    const requestedDefaultY = Number(settings.defaultY);
    const defaultX = Number.isFinite(requestedDefaultX) ? requestedDefaultX : 25;
    const defaultY = Number.isFinite(requestedDefaultY) ? requestedDefaultY : 0;

    return {
      x: normalizeWorldCoordinate(source.x, defaultX, maxTranslation),
      y: normalizeWorldCoordinate(source.y, defaultY, maxTranslation),
      scale
    };
  }

  function computeRenderOrigin(view, viewport, quantum = 4096) {
    const source = view && typeof view === "object" ? view : {};
    const area = viewport && typeof viewport === "object" ? viewport : {};
    const x = Number(source.x), y = Number(source.y), scale = Number(source.scale);
    const width = Number(area.width), height = Number(area.height);
    const requestedQuantum = Number(quantum);
    const cellSize = Number.isFinite(requestedQuantum) && requestedQuantum >= 256 && requestedQuantum <= 65536
      ? requestedQuantum
      : 4096;
    if (![x, y, scale, width, height].every(Number.isFinite) || scale <= 0 || width <= 0 || height <= 0) {
      return { x: 0, y: 0 };
    }
    const centerX = (width / 2 - x) / scale;
    const centerY = (height / 2 - y) / scale;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return { x: 0, y: 0 };
    return {
      x: Math.floor(centerX / cellSize) * cellSize,
      y: Math.floor(centerY / cellSize) * cellSize
    };
  }

  function rebasePoint(point, origin) {
    const source = point && typeof point === "object" ? point : {};
    const base = origin && typeof origin === "object" ? origin : {};
    const x = Number(source.x), y = Number(source.y);
    const originX = Number(base.x), originY = Number(base.y);
    if (![x, y, originX, originY].every(Number.isFinite)) return { x: 0, y: 0 };
    return { x: x - originX, y: y - originY };
  }

  function createRebasedTransform(view, origin) {
    const source = view && typeof view === "object" ? view : {};
    const base = origin && typeof origin === "object" ? origin : {};
    const x = Number(source.x), y = Number(source.y), scale = Number(source.scale);
    const originX = Number(base.x), originY = Number(base.y);
    if (![x, y, scale, originX, originY].every(Number.isFinite) || scale <= 0) {
      return { x: 0, y: 0, scale: 1 };
    }
    const translatedX = x + originX * scale;
    const translatedY = y + originY * scale;
    if (!Number.isFinite(translatedX) || !Number.isFinite(translatedY)) {
      return { x: 0, y: 0, scale: 1 };
    }
    return { x: translatedX, y: translatedY, scale };
  }

  function intersects(a, b) {
    return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
  }

  class SpatialIndex {
    constructor(cellSize = DEFAULT_CELL_SIZE) {
      const size = Number(cellSize);
      if (!Number.isFinite(size) || size < 64 || size > 8192) {
        throw new RangeError("SpatialIndex cell size must be between 64 and 8192 world units.");
      }
      this.cellSize = size;
      this.coarseCellSize = size * 64;
      this.cells = new Map();
      this.coarseCells = new Map();
      this.entries = new Map();
      this.oversized = new Set();
      this.coarseOversized = new Set();
    }

    get size() { return this.entries.size; }

    get(id) { return this.entries.get(id)?.item; }

    clear() {
      this.cells.clear();
      this.coarseCells.clear();
      this.entries.clear();
      this.oversized.clear();
      this.coarseOversized.clear();
    }

    rebuild(items) {
      this.clear();
      if (!Array.isArray(items)) return;
      for (const item of items) this.upsert(item);
    }

    upsert(item) {
      if (!item || typeof item.id !== "string" || !item.id) return false;
      const rect = normalizeRect(item);
      if (!rect) {
        this.remove(item.id);
        return false;
      }
      this.remove(item.id);

      const fine = this._rangeMetrics(rect, this.cellSize);
      const coarse = this._rangeMetrics(rect, this.coarseCellSize);
      const fineOversized = !fine || fine.cellCount > MAX_CELLS_PER_ITEM;
      const coarseOversized = !coarse || coarse.cellCount > MAX_CELLS_PER_ITEM;
      const fineKeys = fineOversized ? null : this._addToMap(this.cells, fine.range, item.id);
      const coarseKeys = coarseOversized ? null : this._addToMap(this.coarseCells, coarse.range, item.id);

      if (fineOversized) this.oversized.add(item.id);
      if (coarseOversized) this.coarseOversized.add(item.id);
      this.entries.set(item.id, {
        item, rect, fineKeys, coarseKeys, fineOversized, coarseOversized
      });
      return true;
    }

    remove(id) {
      const entry = this.entries.get(id);
      if (!entry) return false;
      if (entry.fineOversized) this.oversized.delete(id);
      else this._removeFromMap(this.cells, entry.fineKeys, id);
      if (entry.coarseOversized) this.coarseOversized.delete(id);
      else this._removeFromMap(this.coarseCells, entry.coarseKeys, id);
      this.entries.delete(id);
      return true;
    }

    query(queryRect) {
      const rect = normalizeRect(queryRect);
      if (!rect || this.entries.size === 0) return [];

      const fine = this._rangeMetrics(rect, this.cellSize);
      let candidateIds;
      if (fine && fine.cellCount <= MAX_CELLS_PER_QUERY) {
        candidateIds = new Set(this.oversized);
        this._collectFromMap(this.cells, fine.range, candidateIds);
      } else {
        const coarse = this._rangeMetrics(rect, this.coarseCellSize);
        if (coarse && coarse.cellCount <= MAX_CELLS_PER_QUERY) {
          candidateIds = new Set(this.coarseOversized);
          this._collectFromMap(this.coarseCells, coarse.range, candidateIds);
        } else {
          candidateIds = new Set(this.entries.keys());
        }
      }

      const results = [];
      for (const id of candidateIds) {
        const entry = this.entries.get(id);
        if (entry && intersects(entry.rect, rect)) results.push(entry.item);
      }
      return results;
    }

    _rangeMetrics(rect, size) {
      const range = this._cellRange(rect, size);
      const safeRange = [range.minX, range.minY, range.maxX, range.maxY].every(Number.isSafeInteger);
      if (!safeRange) return null;
      const columns = range.maxX - range.minX + 1;
      const rows = range.maxY - range.minY + 1;
      const cellCount = columns * rows;
      if (!Number.isSafeInteger(cellCount) || cellCount <= 0) return null;
      return { range, cellCount };
    }

    _addToMap(map, range, id) {
      const keys = [];
      for (let cellY = range.minY; cellY <= range.maxY; cellY += 1) {
        for (let cellX = range.minX; cellX <= range.maxX; cellX += 1) {
          const key = this._key(cellX, cellY);
          let bucket = map.get(key);
          if (!bucket) {
            bucket = new Set();
            map.set(key, bucket);
          }
          bucket.add(id);
          keys.push(key);
        }
      }
      return keys;
    }

    _removeFromMap(map, keys, id) {
      for (const key of keys || []) {
        const bucket = map.get(key);
        if (!bucket) continue;
        bucket.delete(id);
        if (bucket.size === 0) map.delete(key);
      }
    }

    _collectFromMap(map, range, target) {
      for (let cellY = range.minY; cellY <= range.maxY; cellY += 1) {
        for (let cellX = range.minX; cellX <= range.maxX; cellX += 1) {
          const bucket = map.get(this._key(cellX, cellY));
          if (bucket) for (const id of bucket) target.add(id);
        }
      }
    }

    _cellRange(rect, size = this.cellSize) {
      return {
        minX: Math.floor(rect.x / size),
        minY: Math.floor(rect.y / size),
        maxX: Math.ceil(rect.right / size) - 1,
        maxY: Math.ceil(rect.bottom / size) - 1
      };
    }

    _key(x, y) { return x + ":" + y; }
  }

  function sortByZIndex(items) {
    if (!Array.isArray(items)) return [];
    return items.slice().sort((left, right) =>
      (Number(right?.z) || 0) - (Number(left?.z) || 0)
    );
  }

  function cycleIndex(currentIndex, itemCount, reverse) {
    const count = Math.floor(Number(itemCount));
    if (!Number.isFinite(count) || count <= 0) return -1;
    const current = Number.isInteger(currentIndex) ? currentIndex : -1;
    if (current < 0 || current >= count) return reverse ? count - 1 : 0;
    return (current + (reverse ? -1 : 1) + count) % count;
  }

  function claimUniqueId(candidate, usedIds, generateId) {
    if (!(usedIds instanceof Set)) throw new TypeError("claimUniqueId requires a Set of previously used IDs.");
    const valid = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
    let id = valid(candidate) ? candidate : "";
    if (!id || usedIds.has(id)) {
      if (typeof generateId !== "function") throw new TypeError("claimUniqueId requires an ID generator for invalid or duplicate IDs.");
      do { id = generateId(); } while (!valid(id) || usedIds.has(id));
    }
    usedIds.add(id);
    return id;
  }

  const api = Object.freeze({
    SpatialIndex, sortByZIndex, cycleIndex, claimUniqueId,
    normalizeWorldCoordinate, normalizeViewState,
    computeRenderOrigin, rebasePoint, createRebasedTransform
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.NolaneSpatialIndex = api;
})();
