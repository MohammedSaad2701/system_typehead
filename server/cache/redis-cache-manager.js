const ConsistentHashRing = require('./consistent-hash');
const RedisCacheNode = require('./redis-cache-node');

class RedisCacheManager {
  constructor({ urls, virtualNodes = 150, ttlMs = 60000, clientFactory }) {
    if (!Array.isArray(urls) || urls.length !== 3) {
      throw new Error('Redis cache requires exactly three node URLs');
    }
    this.backend = 'redis';
    this.ttlMs = ttlMs;
    this.ring = new ConsistentHashRing(virtualNodes);
    this.nodes = new Map();
    urls.forEach((url, index) => {
      const nodeId = `redis-node-${index}`;
      this.nodes.set(nodeId, new RedisCacheNode(nodeId, url, { clientFactory }));
      this.ring.addNode(nodeId);
    });
  }

  async initialize() {
    await Promise.all([...this.nodes.values()].map((node) => node.connect()));
    console.log(`[CACHE] Connected to ${this.nodes.size} Redis nodes`);
    return this;
  }

  key(prefix, mode) {
    return `suggest:${mode}:${prefix}`;
  }

  route(key) {
    const location = this.ring.locate(key);
    return { ...location, node: this.nodes.get(location.nodeId) };
  }

  async get(prefix, mode) {
    const key = this.key(prefix, mode);
    return this.route(key).node.get(key);
  }

  async set(prefix, mode, value) {
    const key = this.key(prefix, mode);
    return this.route(key).node.set(key, value, this.ttlMs);
  }

  keysForQuery(normalizedQuery, modes) {
    const byNode = new Map();
    for (let length = 1; length <= normalizedQuery.length; length += 1) {
      const prefix = normalizedQuery.slice(0, length);
      for (const mode of modes) {
        const key = this.key(prefix, mode);
        const route = this.route(key);
        if (!byNode.has(route.nodeId)) byNode.set(route.nodeId, []);
        byNode.get(route.nodeId).push(key);
      }
    }
    return byNode;
  }

  async invalidateKeysByNode(byNode) {
    const results = await Promise.all(
      [...byNode.entries()].map(([nodeId, keys]) => this.nodes.get(nodeId).invalidate(keys))
    );
    return results.reduce((sum, value) => sum + value, 0);
  }

  async invalidateQuery(normalizedQuery) {
    return this.invalidateKeysByNode(this.keysForQuery(normalizedQuery, ['count', 'trend']));
  }

  async invalidateTrendQuery(normalizedQuery) {
    return this.invalidateKeysByNode(this.keysForQuery(normalizedQuery, ['trend']));
  }

  async invalidateAllTrend() {
    const results = await Promise.all(
      [...this.nodes.values()].map((node) => node.invalidatePattern('suggest:trend:*'))
    );
    return results.reduce((sum, value) => sum + value, 0);
  }

  async nodeStats() {
    return Promise.all([...this.nodes.values()].map((node) => node.snapshot()));
  }

  async getAggregateStats() {
    return (await this.nodeStats()).reduce(
      (total, node) => ({
        hits: total.hits + node.hits,
        misses: total.misses + node.misses,
        errors: total.errors + node.errors,
        size: total.size + node.size,
        healthyNodes: total.healthyNodes + (node.healthy ? 1 : 0)
      }),
      { hits: 0, misses: 0, errors: 0, size: 0, healthyNodes: 0 }
    );
  }

  async debug(prefix, mode = 'count') {
    const key = this.key(prefix, mode);
    const route = this.route(key);
    return {
      prefix,
      mode,
      key,
      backend: 'redis',
      hashValue: route.hashValue,
      ringPosition: route.position,
      ringIndex: route.ringIndex,
      assignedNode: route.nodeId,
      assignedUrl: route.node.url,
      hit: (await route.node.peek(key)) !== null,
      nodeStats: await this.nodeStats(),
      distribution: this.ring.getDistribution()
    };
  }

  async simulateMembership({ action, nodeId, sampleKeys = [] }) {
    const simulated = new ConsistentHashRing(this.ring.virtualNodes);
    for (const existingNode of this.nodes.keys()) simulated.addNode(existingNode);
    const before = new Map(sampleKeys.map((key) => [key, simulated.locate(key).nodeId]));
    if (action === 'add') simulated.addNode(nodeId);
    else if (this.nodes.size > 1) simulated.removeNode(nodeId);
    let remapped = 0;
    for (const key of sampleKeys) {
      if (before.get(key) !== simulated.locate(key).nodeId) remapped += 1;
    }
    return {
      changed: action === 'add' || this.nodes.has(nodeId),
      applied: false,
      note: 'Redis membership endpoint simulates remapping; change REDIS_URLS to apply topology changes.',
      action,
      nodeId,
      sampledKeys: sampleKeys.length,
      remappedKeys: remapped,
      remappedPercent: sampleKeys.length
        ? Number(((remapped / sampleKeys.length) * 100).toFixed(2))
        : 0,
      distribution: simulated.getDistribution()
    };
  }

  async close() {
    await Promise.all([...this.nodes.values()].map((node) => node.close()));
  }
}

module.exports = RedisCacheManager;
