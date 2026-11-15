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
    return { x, y, w: width, h: height, right: x + width, bottom: y + height };
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
      const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
      if (!Number.isSafeInteger(cellCount) || cellCount > MAX_CELLS_PER_ITEM) {
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
      const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
      const candidateIds = new Set(this.oversized);
      if (!Number.isSafeInteger(cellCount) || cellCount > MAX_CELLS_PER_QUERY) {
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

  const api = Object.freeze({ SpatialIndex, sortByZIndex });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.NolaneSpatialIndex = api;
})();
