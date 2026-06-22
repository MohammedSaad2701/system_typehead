const express = require('express');
const path = require('node:path');
const config = require('./config');
const { normalizeQuery, validateSearchQuery } = require('./lib/normalize');

const DEFAULT_MODE = 'count';
const RANKING_MODES = new Set(['count', 'trend']);
const TREND_CANDIDATE_LIMIT = 100;
const DEBUG_SAMPLE_SIZE = 1000;

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function toPublicSuggestion(entry) {
  const suggestion = { query: entry.query, count: entry.count };
  if (entry.trendScore !== undefined) suggestion.trendScore = entry.trendScore;
  return suggestion;
}

function readMode(value) {
  return value || DEFAULT_MODE;
}

function validateSuggestionRequest(query) {
  const rawPrefix = query.q;
  const mode = readMode(query.mode);

  if (rawPrefix === undefined) return { error: 'q query parameter is required' };
  if (typeof rawPrefix !== 'string') return { error: 'q must be a string' };
  if (!RANKING_MODES.has(mode)) return { error: 'mode must be count or trend' };

  const prefix = normalizeQuery(rawPrefix);
  if (prefix.length > config.maxQueryLength) {
    return { error: `q must be at most ${config.maxQueryLength} characters` };
  }
  return { prefix, mode };
}

function validateDebugRequest(query) {
  const prefix = typeof query.prefix === 'string' ? normalizeQuery(query.prefix) : '';
  const mode = readMode(query.mode);

  if (!prefix) return { error: 'prefix is required' };
  if (!RANKING_MODES.has(mode)) return { error: 'mode must be count or trend' };
  return { prefix, mode };
}

function getTrendingSuggestions(prefix, services) {
  const { database, trending } = services;
  const recentCounts = trending.getWeightedRecentCounts();
  const historicalMatches = database.getSuggestions(prefix, TREND_CANDIDATE_LIMIT, TREND_CANDIDATE_LIMIT);
  const recentMatches = [...recentCounts.keys()]
    .filter((query) => query.startsWith(prefix))
    .sort((a, b) => recentCounts.get(b) - recentCounts.get(a))
    .slice(0, TREND_CANDIDATE_LIMIT);

  const candidates = new Map(historicalMatches.map((entry) => [entry.normalizedQuery, entry]));
  for (const entry of database.getQueries(recentMatches)) candidates.set(entry.normalizedQuery, entry);

  return trending.rankEntries(
    [...candidates.values()],
    database.getMaxCount(),
    recentCounts,
    config.suggestionLimit
  );
}

async function getSuggestions(prefix, mode, services) {
  const { cache, database } = services;
  const cachedSuggestions = await cache.get(prefix, mode);
  if (cachedSuggestions !== null) return { suggestions: cachedSuggestions, cached: true };

  const suggestions = mode === 'trend'
    ? getTrendingSuggestions(prefix, services)
    : database.getSuggestions(prefix, config.suggestionLimit);

  await cache.set(prefix, mode, suggestions);
  return { suggestions, cached: false };
}

async function buildStats(services) {
  const { cache, metrics, database, batchWriter } = services;
  const cacheStats = await cache.getAggregateStats();
  const attempts = cacheStats.hits + cacheStats.misses;

  return {
    ...metrics.snapshot(),
    cache: {
      ...cacheStats,
      hitRate: attempts ? Number(((cacheStats.hits / attempts) * 100).toFixed(2)) : 0,
      backend: cache.backend,
      nodes: await cache.nodeStats(),
      distribution: cache.ring.getDistribution()
    },
    database: database.getMetrics(),
    batch: batchWriter.getStats(),
    dataset: { rows: database.getCount(), source: 'Wikimedia Pageviews (CC0)' }
  };
}

function createApp(services) {
  const { cache, trending, batchWriter, database } = services;
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(services.metrics.middleware());

  app.get('/suggest', asyncRoute(async (request, response) => {
    const validation = validateSuggestionRequest(request.query);
    if (validation.error) return response.status(400).json({ error: validation.error });
    if (!validation.prefix) return response.json({ suggestions: [], cached: false, latencyMs: 0 });

    const startedAt = process.hrtime.bigint();
    const { suggestions, cached } = await getSuggestions(validation.prefix, validation.mode, services);
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    services.metrics.recordSuggestion(latencyMs);

    return response.json({
      suggestions: suggestions.map(toPublicSuggestion),
      cached,
      latencyMs: Number(latencyMs.toFixed(3))
    });
  }));

  app.post('/search', asyncRoute(async (request, response) => {
    const validation = validateSearchQuery(request.body?.query, config.maxQueryLength);
    if (!validation.valid) return response.status(400).json({ error: validation.error });

    trending.recordSearch(validation.normalizedQuery);
    await cache.invalidateTrendQuery(validation.normalizedQuery);
    batchWriter.enqueue(validation.normalizedQuery, validation.displayQuery);

    return response.status(202).json({ message: 'Searched', query: validation.displayQuery });
  }));

  app.get('/trending', (_request, response) => {
    response.json({ trending: trending.getTrending(database, config.suggestionLimit).map(toPublicSuggestion) });
  });

  app.get('/cache/debug', asyncRoute(async (request, response) => {
    const validation = validateDebugRequest(request.query);
    if (validation.error) return response.status(400).json({ error: validation.error });
    return response.json(await cache.debug(validation.prefix, validation.mode));
  }));

  app.get('/stats', asyncRoute(async (_request, response) => {
    response.json(await buildStats(services));
  }));

  if (config.environment !== 'production') {
    app.post('/flush', asyncRoute(async (_request, response) => {
      response.json(await batchWriter.flush());
    }));

    app.post('/cache/nodes/:nodeId', asyncRoute(async (request, response) => {
      const action = request.body?.action;
      if (!['add', 'remove'].includes(action)) {
        return response.status(400).json({ error: 'action must be add or remove' });
      }

      const sampleKeys = Array.from({ length: DEBUG_SAMPLE_SIZE }, (_, index) => `sample-prefix-${index}`);
      return response.json(await cache.simulateMembership({
        action,
        nodeId: request.params.nodeId,
        sampleKeys
      }));
    }));
  }

  app.use(express.static(path.join(config.root, 'public')));
  app.get('*splat', (_request, response) => response.sendFile(path.join(config.root, 'public', 'index.html')));
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
