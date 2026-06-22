const test = require('node:test');
const assert = require('node:assert/strict');
const RedisCacheManager = require('../server/cache/redis-cache-manager');

class FakeRedisClient {
  constructor(options) {
    this.url = options.url;
    this.isOpen = false;
    this.values = new Map();
  }

  on() {}

  async connect() {
    this.isOpen = true;
  }

  async ping() {
    if (!this.isOpen) throw new Error('not connected');
    return 'PONG';
  }

  async get(key) {
    const item = this.values.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key, value, options) {
    this.values.set(key, { value, expiresAt: Date.now() + options.PX });
    return 'OK';
  }

  async del(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    let removed = 0;
    for (const key of list) {
      if (this.values.delete(key)) removed += 1;
    }
    return removed;
  }

  async *scanIterator({ MATCH }) {
    const prefix = MATCH.replace('*', '');
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) yield key;
    }
  }

  async dbSize() {
    return this.values.size;
  }

  async quit() {
    this.isOpen = false;
  }
}

test('Redis cache routes keys across exactly three independent clients', async () => {
  const clients = [];
  const manager = new RedisCacheManager({
    urls: ['redis://one:6379', 'redis://two:6379', 'redis://three:6379'],
    virtualNodes: 150,
    ttlMs: 1000,
    clientFactory: (options) => {
      const client = new FakeRedisClient(options);
      clients.push(client);
      return client;
    }
  });
  await manager.initialize();
  try {
    assert.equal(clients.length, 3);
    assert.equal(new Set(clients.map((client) => client.url)).size, 3);
    await manager.set('app', 'count', [{ query: 'Apple', count: 10 }]);
    assert.equal((await manager.get('app', 'count'))[0].query, 'Apple');
    assert.equal((await manager.get('app', 'trend')), null);
    const debug = await manager.debug('app', 'count');
    assert.equal(debug.backend, 'redis');
    assert.match(debug.assignedNode, /^redis-node-[0-2]$/);
    assert.equal(debug.hit, true);
    assert.equal(debug.nodeStats.length, 3);
    assert.ok(debug.nodeStats.every((node) => node.healthy));
  } finally {
    await manager.close();
  }
});

test('Redis cache invalidates exact prefix keys and trend keys across shards', async () => {
  const manager = new RedisCacheManager({
    urls: ['redis://one:6379', 'redis://two:6379', 'redis://three:6379'],
    virtualNodes: 40,
    ttlMs: 1000,
    clientFactory: (options) => new FakeRedisClient(options)
  });
  await manager.initialize();
  try {
    await manager.set('a', 'count', [1]);
    await manager.set('ap', 'count', [2]);
    await manager.set('app', 'trend', [3]);
    await manager.set('other', 'trend', [4]);
    await manager.invalidateQuery('app');
    assert.equal(await manager.get('a', 'count'), null);
    assert.equal(await manager.get('ap', 'count'), null);
    assert.equal(await manager.get('app', 'trend'), null);
    assert.deepEqual(await manager.get('other', 'trend'), [4]);
    await manager.invalidateAllTrend();
    assert.equal(await manager.get('other', 'trend'), null);
  } finally {
    await manager.close();
  }
});
