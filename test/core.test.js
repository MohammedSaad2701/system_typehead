const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CacheNode = require('../server/cache/cache-node');
const ConsistentHashRing = require('../server/cache/consistent-hash');
const CacheManager = require('../server/cache/cache-manager');
const TrendingManager = require('../server/trending/trending');
const QueryDatabase = require('../server/db/sqlite');

test('SQLite returns prefix matches sorted by count and upserts new queries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typeahead-db-test-'));
  const database = new QueryDatabase(path.join(directory, 'test.db'));
  try {
    database.bulkReplace([
      { normalizedQuery: 'iphone', displayQuery: 'iPhone', count: 100, updatedAt: 1 },
      { normalizedQuery: 'iphone charger', displayQuery: 'iPhone Charger', count: 80, updatedAt: 1 },
      { normalizedQuery: 'ipad', displayQuery: 'iPad', count: 90, updatedAt: 1 }
    ]);
    assert.deepEqual(database.getSuggestions('iph').map((item) => item.query), ['iPhone', 'iPhone Charger']);
    database.bulkUpsert([
      { normalizedQuery: 'iphone charger', displayQuery: 'IPHONE CHARGER', delta: 30, updatedAt: 2 },
      { normalizedQuery: 'iphone case', displayQuery: 'iPhone Case', delta: 5, updatedAt: 2 }
    ]);
    assert.equal(database.getSuggestions('iph')[0].query, 'iPhone Charger');
    assert.equal(database.getCount(), 4);
    assert.ok(database.getSuggestions('iphone').every((item) => item.normalizedQuery.startsWith('iphone')));
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Cache node expires values without counting debug peeks as hits', () => {
  let now = 100;
  const node = new CacheNode('n1', () => now);
  node.set('key', ['value'], 50);
  assert.deepEqual(node.peek('key'), ['value']);
  assert.equal(node.stats.hits, 0);
  assert.deepEqual(node.get('key'), ['value']);
  now = 151;
  assert.equal(node.get('key'), null);
  assert.equal(node.stats.misses, 1);
  assert.equal(node.stats.evictions, 1);
});

test('Consistent hash ring is deterministic, balanced, and limits remapping', () => {
  const ring = new ConsistentHashRing(150);
  for (let index = 0; index < 4; index += 1) ring.addNode(`node-${index}`);
  assert.equal(ring.locate('suggest:count:iph').nodeId, ring.locate('suggest:count:iph').nodeId);
  const distribution = ring.getDistribution();
  for (const share of Object.values(distribution)) assert.ok(share > 15 && share < 35);
  const keys = Array.from({ length: 5000 }, (_, index) => `key-${index}`);
  const before = keys.map((key) => ring.locate(key).nodeId);
  ring.addNode('node-4');
  const changed = keys.filter((key, index) => ring.locate(key).nodeId !== before[index]).length;
  assert.ok(changed / keys.length < 0.35);
});

test('Cache manager isolates ranking modes and invalidates every query prefix', async () => {
  const cache = await new CacheManager({
    nodeCount: 4, virtualNodes: 40, ttlMs: 1000, sweepMs: 5000
  }).initialize();
  try {
    await cache.set('iph', 'count', [{ query: 'iphone' }]);
    await cache.set('iph', 'trend', [{ query: 'iphone charger' }]);
    await cache.set('iphone', 'count', [{ query: 'iphone' }]);
    assert.equal((await cache.get('iph', 'count'))[0].query, 'iphone');
    assert.equal((await cache.get('iph', 'trend'))[0].query, 'iphone charger');
    await cache.invalidateQuery('iphone');
    assert.equal(await cache.get('iph', 'count'), null);
    assert.equal(await cache.get('iph', 'trend'), null);
    assert.equal(await cache.get('iphone', 'count'), null);
  } finally {
    await cache.close();
  }
});

test('Trending score responds to recent activity and decays after bucket rotation', () => {
  const trending = new TrendingManager({ bucketCount: 3, bucketDurationMs: 60000, decay: 0.5 });
  try {
    trending.recordSearch('rare query');
    trending.recordSearch('rare query');
    const fresh = trending.computeTrendScore('rare query', 1, 1000);
    trending.rotate();
    trending.recordSearch('fresh competitor');
    trending.recordSearch('fresh competitor');
    const older = trending.computeTrendScore('rare query', 1, 1000);
    trending.rotate();
    trending.rotate();
    const expired = trending.computeTrendScore('rare query', 1, 1000);
    assert.ok(fresh > older);
    assert.ok(older > expired);
  } finally {
    trending.close();
  }
});
