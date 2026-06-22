const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const QueryDatabase = require('../server/db/sqlite');
const CacheManager = require('../server/cache/cache-manager');
const TrendingManager = require('../server/trending/trending');
const BatchWriter = require('../server/batch/batch-writer');
const Metrics = require('../server/middleware/metrics');
const createApp = require('../server/app');

async function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typeahead-test-'));
  const database = new QueryDatabase(path.join(directory, 'test.db'));
  const rows = [
    { normalizedQuery: 'iphone', displayQuery: 'iPhone', count: 100, updatedAt: Date.now() },
    { normalizedQuery: 'iphone charger', displayQuery: 'iPhone Charger', count: 80, updatedAt: Date.now() },
    { normalizedQuery: 'ipad', displayQuery: 'iPad', count: 90, updatedAt: Date.now() }
  ];
  database.bulkReplace(rows);
  const cache = await new CacheManager({
    nodeCount: 4, virtualNodes: 20, ttlMs: 1000, sweepMs: 5000
  }).initialize();
  const metrics = new Metrics();
  const trending = new TrendingManager({ bucketDurationMs: 60000, onRotate: () => cache.invalidateAllTrend() });
  const batchWriter = new BatchWriter({
    database, cache, metrics, maxUniqueQueries: 50, flushIntervalMs: 60000
  });
  const services = { database, cache, metrics, trending, batchWriter };
  return {
    app: createApp(services),
    services,
    async close() {
      await batchWriter.close();
      trending.close();
      await cache.close();
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

test('suggest API validates inputs, normalizes case, caches, and supports modes', async () => {
  const fixture = await createFixture();
  try {
    await request(fixture.app).get('/suggest').expect(400);
    const empty = await request(fixture.app).get('/suggest?q=').expect(200);
    assert.deepEqual(empty.body.suggestions, []);
    const noMatch = await request(fixture.app).get('/suggest?q=zzzz').expect(200);
    assert.deepEqual(noMatch.body.suggestions, []);
    const cold = await request(fixture.app).get('/suggest?q=IPH').expect(200);
    assert.equal(cold.body.cached, false);
    assert.deepEqual(cold.body.suggestions.map((item) => item.query), ['iPhone', 'iPhone Charger']);
    const warm = await request(fixture.app).get('/suggest?q=iph').expect(200);
    assert.equal(warm.body.cached, true);
    await request(fixture.app).get('/suggest?q=iph&mode=invalid').expect(400);
    await request(fixture.app).get('/suggest?q=iph&mode=trend').expect(200);
  } finally {
    await fixture.close();
  }
});

test('search API batches repeated writes and updates suggestions after flush', async () => {
  const fixture = await createFixture();
  try {
    await request(fixture.app).post('/search').send({}).expect(400);
    await request(fixture.app).post('/search').send({ query: 'x'.repeat(201) }).expect(400);
    for (let index = 0; index < 5; index += 1) {
      const response = await request(fixture.app).post('/search').send({ query: 'iPhone Charger' }).expect(202);
      assert.equal(response.body.message, 'Searched');
    }
    const flush = await request(fixture.app).post('/flush').expect(200);
    assert.equal(flush.body.queriesWritten, 1);
    assert.equal(flush.body.totalCounts, 5);
    assert.equal(flush.body.writesSaved, 4);
    const suggestions = await request(fixture.app).get('/suggest?q=iph').expect(200);
    assert.equal(suggestions.body.suggestions.find((item) => item.query === 'iPhone Charger').count, 85);
    const trending = await request(fixture.app).get('/trending').expect(200);
    assert.ok(trending.body.trending.some((item) => item.query === 'iPhone Charger'));

    await request(fixture.app).post('/search').send({ query: 'iPhone Case' }).expect(202);
    await request(fixture.app).post('/flush').expect(200);
    const inserted = await request(fixture.app).get('/suggest?q=iphone case').expect(200);
    assert.equal(inserted.body.suggestions[0].count, 1);
  } finally {
    await fixture.close();
  }
});

test('debug and stats APIs expose routing and observability', async () => {
  const fixture = await createFixture();
  try {
    const miss = await request(fixture.app).get('/cache/debug?prefix=iph').expect(200);
    assert.match(miss.body.assignedNode, /^cache-node-/);
    assert.equal(miss.body.hit, false);
    assert.equal(Object.keys(miss.body.distribution).length, 4);
    await request(fixture.app).get('/suggest?q=iph').expect(200);
    const hit = await request(fixture.app).get('/cache/debug?prefix=iph').expect(200);
    assert.equal(hit.body.hit, true);
    const stats = await request(fixture.app).get('/stats').expect(200);
    assert.equal(stats.body.dataset.rows, 3);
    assert.equal(stats.body.cache.nodes.length, 4);
    const membership = await request(fixture.app)
      .post('/cache/nodes/cache-node-demo')
      .send({ action: 'add' })
      .expect(200);
    assert.equal(membership.body.changed, true);
    assert.ok(membership.body.remappedPercent > 0);
  } finally {
    await fixture.close();
  }
});
