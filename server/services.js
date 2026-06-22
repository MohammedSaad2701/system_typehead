const fs = require('node:fs');
const config = require('./config');
const QueryDatabase = require('./db/sqlite');
const { loadDataset } = require('./db/loader');
const { createCache } = require('./cache/cache-factory');
const TrendingManager = require('./trending/trending');
const BatchWriter = require('./batch/batch-writer');
const Metrics = require('./middleware/metrics');

async function createServices(overrides = {}) {
  const database = overrides.database || new QueryDatabase(config.databasePath);
  if (!database.getCount()) {
    if (!fs.existsSync(config.datasetPath)) {
      throw new Error('Dataset is missing. Run npm run setup to download and load Wikimedia Pageviews.');
    }
    loadDataset(database);
  }
  const cache = await createCache(config.cache, overrides);
  const metrics = overrides.metrics || new Metrics();
  const trending = overrides.trending || new TrendingManager({
    ...config.trending,
    onRotate: () => cache.invalidateAllTrend()
  });
  const batchWriter = overrides.batchWriter || new BatchWriter({
    database,
    cache,
    metrics,
    ...config.batch
  });
  return { database, cache, metrics, trending, batchWriter };
}

async function closeServices(services) {
  await services.batchWriter.close();
  services.trending.close();
  await services.cache.close();
  services.database.close();
}

module.exports = { createServices, closeServices };
