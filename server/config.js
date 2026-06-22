const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  environment: process.env.NODE_ENV || 'development',
  databasePath: process.env.DB_PATH || path.join(ROOT, 'data', 'typeahead.db'),
  datasetPath: process.env.DATASET_PATH || path.join(ROOT, 'dataset', 'queries.csv'),
  datasetMetadataPath: process.env.DATASET_METADATA_PATH || path.join(ROOT, 'dataset', 'metadata.json'),
  datasetSourceUrl: process.env.DATASET_SOURCE_URL
    || 'https://dumps.wikimedia.org/other/pageviews/2025/2025-01/pageviews-20250101-000000.gz',
  datasetSize: Number(process.env.DATASET_SIZE || 120000),
  maxQueryLength: 200,
  suggestionLimit: 10,
  cache: {
    backend: process.env.CACHE_BACKEND || 'memory',
    nodeCount: Number(process.env.CACHE_NODES || 4),
    virtualNodes: 150,
    ttlMs: Number(process.env.CACHE_TTL_MS || 60000),
    sweepMs: Number(process.env.CACHE_SWEEP_MS || 30000),
    redisUrls: (process.env.REDIS_URLS
      || 'redis://127.0.0.1:6379,redis://127.0.0.1:6380,redis://127.0.0.1:6381')
      .split(',')
      .map((url) => url.trim())
  },
  batch: {
    maxUniqueQueries: Number(process.env.BATCH_SIZE || 50),
    flushIntervalMs: Number(process.env.BATCH_INTERVAL_MS || 5000)
  },
  trending: {
    bucketCount: 10,
    bucketDurationMs: Number(process.env.TREND_BUCKET_MS || 30000),
    decay: 0.9,
    historicalWeight: 0.4,
    recentWeight: 0.6
  }
};
