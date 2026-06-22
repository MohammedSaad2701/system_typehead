const CacheNode = require('./cache-node');
const ConsistentHashRing = require('./consistent-hash');

class CacheManager {
  constructor({ nodeCount = 4, virtualNodes = 150, ttlMs = 60000, sweepMs = 30000, now }) {
    this.backend = 'memory';
    this.ttlMs = ttlMs;
    this.now = now || (() => Date.now());
    this.ring = new ConsistentHashRing(virtualNodes);
    this.nodes = new Map();
    for (let index = 0; index < nodeCount; index += 1) this.addNode(`cache-node-${index}`);
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    this.sweepTimer.unref?.();
  }

  key(prefix, mode) {
    return `suggest:${mode}:${prefix}`;
  }

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return false;
    this.nodes.set(nodeId, new CacheNode(nodeId, this.now));
    this.ring.addNode(nodeId);
    return true;
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId) || this.nodes.size === 1) return false;
    this.nodes.delete(nodeId);
    this.ring.removeNode(nodeId);
    return true;
  }

  route(key) {
    const location = this.ring.locate(key);
    return { ...location, node: this.nodes.get(location.nodeId) };
  }

  async initialize() {
    return this;
  }

  async get(prefix, mode) {
    const key = this.key(prefix, mode);
    return this.route(key).node.get(key);
  }

  async set(prefix, mode, value) {
    const key = this.key(prefix, mode);
    this.route(key).node.set(key, value, this.ttlMs);
  }

  async invalidateQuery(normalizedQuery) {
    let removed = 0;
    for (let length = 1; length <= normalizedQuery.length; length += 1) {
      const prefix = normalizedQuery.slice(0, length);
      for (const mode of ['count', 'trend']) {
        const key = this.key(prefix, mode);
        if (this.route(key).node.invalidate(key)) removed += 1;
      }
    }
    return removed;
  }

  async invalidateAllTrend() {
    let removed = 0;
    for (const node of this.nodes.values()) {
      for (const key of [...node.store.keys()]) {
        if (key.startsWith('suggest:trend:') && node.invalidate(key)) removed += 1;
      }
    }
    return removed;
  }

  async invalidateTrendQuery(normalizedQuery) {
    let removed = 0;
    for (let length = 1; length <= normalizedQuery.length; length += 1) {
      const prefix = normalizedQuery.slice(0, length);
      const key = this.key(prefix, 'trend');
      if (this.route(key).node.invalidate(key)) removed += 1;
    }
    return removed;
  }

  async debug(prefix, mode = 'count') {
    const key = this.key(prefix, mode);
    const route = this.route(key);
    return {
      prefix,
      mode,
      key,
      hashValue: route.hashValue,
      ringPosition: route.position,
      ringIndex: route.ringIndex,
      assignedNode: route.nodeId,
      hit: route.node.peek(key) !== null,
      backend: 'memory',
      nodeStats: await this.nodeStats(),
      distribution: this.ring.getDistribution()
    };
  }

  async simulateMembership({ action, nodeId, sampleKeys = [] }) {
    const before = new Map(sampleKeys.map((key) => [key, this.ring.locate(key).nodeId]));
    const changed = action === 'add' ? this.addNode(nodeId) : this.removeNode(nodeId);
    let remapped = 0;
    for (const key of sampleKeys) {
      if (before.get(key) !== this.ring.locate(key).nodeId) remapped += 1;
    }
    return {
      changed,
      action,
      nodeId,
      sampledKeys: sampleKeys.length,
      remappedKeys: remapped,
      remappedPercent: sampleKeys.length ? Number(((remapped / sampleKeys.length) * 100).toFixed(2)) : 0,
      distribution: this.ring.getDistribution()
    };
  }

  sweep() {
    for (const node of this.nodes.values()) node.sweep();
  }

  async nodeStats() {
    return [...this.nodes.values()].map((node) => node.snapshot());
  }

  async getAggregateStats() {
    return (await this.nodeStats()).reduce(
      (total, node) => ({
        hits: total.hits + node.hits,
        misses: total.misses + node.misses,
        evictions: total.evictions + node.evictions,
        size: total.size + node.size
      }),
      { hits: 0, misses: 0, evictions: 0, size: 0 }
    );
  }

  async close() {
    clearInterval(this.sweepTimer);
  }
}

module.exports = CacheManager;
