const CacheManager = require('./cache-manager');
const RedisCacheManager = require('./redis-cache-manager');

async function createCache(config, overrides = {}) {
  if (overrides.cache) return overrides.cache;
  if (!['memory', 'redis'].includes(config.backend)) {
    throw new Error(`Unsupported CACHE_BACKEND: ${config.backend}`);
  }
  const cache = config.backend === 'redis'
    ? new RedisCacheManager({
        urls: config.redisUrls,
        virtualNodes: config.virtualNodes,
        ttlMs: config.ttlMs,
        clientFactory: overrides.redisClientFactory
      })
    : new CacheManager(config);
  return cache.initialize();
}

module.exports = { createCache };
