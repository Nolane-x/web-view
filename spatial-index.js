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

  function normalizeWorldCoordinate(value, fallback = 0, maxAbs = 1_000_000_000) {
    const requestedLimit = Number(maxAbs);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, Number.MAX_SAFE_INTEGER)
      : 1_000_000_000;
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
      : 1_000_000_000;
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
      this.cells = new Map();
      this.entries = new Map();
      this.oversized = new Set();
    }

    get size() { return this.entries.size; }

    get(id) { return this.entries.get(id)?.item; }

    clear() {
      this.cells.clear();
      this.entries.clear();
      this.oversized.clear();
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
      const range = this._cellRange(rect);
      const safeRange = [range.minX, range.minY, range.maxX, range.maxY].every(Number.isSafeInteger);
      const cellCount = safeRange
        ? (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)
        : Number.POSITIVE_INFINITY;
      if (!safeRange || !Number.isSafeInteger(cellCount) || cellCount > MAX_CELLS_PER_ITEM) {
        this.oversized.add(item.id);
        this.entries.set(item.id, { item, rect, keys: null, oversized: true });
        return true;
      }
      const keys = [];
      for (let cellY = range.minY; cellY <= range.maxY; cellY += 1) {
        for (let cellX = range.minX; cellX <= range.maxX; cellX += 1) {
          const key = this._key(cellX, cellY);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = new Set();
            this.cells.set(key, bucket);
          }
          bucket.add(item.id);
          keys.push(key);
        }
      }
      this.entries.set(item.id, { item, rect, keys, oversized: false });
      return true;
    }

    remove(id) {
      const entry = this.entries.get(id);
      if (!entry) return false;
      if (entry.oversized) this.oversized.delete(id);
      else {
        for (const key of entry.keys) {
          const bucket = this.cells.get(key);
          if (!bucket) continue;
          bucket.delete(id);
          if (bucket.size === 0) this.cells.delete(key);
        }
      }
      this.entries.delete(id);
      return true;
    }

    query(queryRect) {
      const rect = normalizeRect(queryRect);
      if (!rect || this.entries.size === 0) return [];
      const range = this._cellRange(rect);
      const safeRange = [range.minX, range.minY, range.maxX, range.maxY].every(Number.isSafeInteger);
      const cellCount = safeRange
        ? (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)
        : Number.POSITIVE_INFINITY;
      const candidateIds = new Set(this.oversized);
      if (!safeRange || !Number.isSafeInteger(cellCount) || cellCount > MAX_CELLS_PER_QUERY) {
        for (const id of this.entries.keys()) candidateIds.add(id);
      } else {
        for (let cellY = range.minY; cellY <= range.maxY; cellY += 1) {
          for (let cellX = range.minX; cellX <= range.maxX; cellX += 1) {
            const bucket = this.cells.get(this._key(cellX, cellY));
            if (bucket) for (const id of bucket) candidateIds.add(id);
          }
        }
      }
      const results = [];
      for (const id of candidateIds) {
        const entry = this.entries.get(id);
        if (entry && intersects(entry.rect, rect)) results.push(entry.item);
      }
      return results;
    }

    _cellRange(rect) {
      return {
        minX: Math.floor(rect.x / this.cellSize),
        minY: Math.floor(rect.y / this.cellSize),
        maxX: Math.ceil(rect.right / this.cellSize) - 1,
        maxY: Math.ceil(rect.bottom / this.cellSize) - 1
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

  const api = Object.freeze({ SpatialIndex, sortByZIndex, cycleIndex, claimUniqueId, normalizeWorldCoordinate, normalizeViewState });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.NolaneSpatialIndex = api;
})();
