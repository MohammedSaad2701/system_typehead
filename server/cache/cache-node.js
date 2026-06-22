class CacheNode {
  constructor(id, now = () => Date.now()) {
    this.id = id;
    this.now = now;
    this.store = new Map();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  peek(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt <= this.now()) {
      this.store.delete(key);
      this.stats.evictions += 1;
      return null;
    }
    return item.value;
  }

  get(key) {
    const value = this.peek(key);
    if (value === null) this.stats.misses += 1;
    else this.stats.hits += 1;
    return value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  invalidate(key) {
    return this.store.delete(key);
  }

  sweep() {
    let removed = 0;
    for (const [key, item] of this.store) {
      if (item.expiresAt <= this.now()) {
        this.store.delete(key);
        removed += 1;
      }
    }
    this.stats.evictions += removed;
    return removed;
  }

  snapshot() {
    return { id: this.id, size: this.store.size, ...this.stats };
  }
}

module.exports = CacheNode;
