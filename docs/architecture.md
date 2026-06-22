# Architecture and Viva Guide

## Read path

The input is trimmed, whitespace-collapsed, and lowercased for lookup. Empty input returns immediately. A cache key includes the ranking mode and normalized prefix. In Redis mode, the consistent-hash ring routes that key to one of three independent Redis servers.

On a hit, the API returns the stored top 10. On a miss, it queries the indexed SQLite primary store using a normalized prefix range and orders matching rows by count. Trend mode expands the candidate set with recently searched matching queries and applies the recency-aware score. Results enter the cache for 60 seconds.

This directly implements the assignment's required `cache → primary data store` fallback. SQLite remains the reliable query-count store used for both reads and batched writes.

## Write path

`POST /search` performs no database write. It records recent activity and increments an in-memory `Map` entry. At 50 unique queries or five seconds:

1. The current map is swapped out so new events can continue accumulating.
2. All unique rows are upserted in one SQLite transaction.
3. Exact cache keys for every prefix and both ranking modes are removed.

For `iphone`, invalidation covers `i`, `ip`, `iph`, `ipho`, `iphon`, and `iphone`. It does not scan unrelated cache entries.

Graceful `SIGINT` and `SIGTERM` shutdown flushes the current buffer. An abrupt crash can lose up to one interval of events. A production design would append every event to Kafka, a durable queue, or a local write-ahead log before acknowledging it.

## Consistent hashing

Each of three Redis nodes contributes 150 virtual points, producing a 450-position ring. A key's MD5 digest supplies a 32-bit ring position; binary search chooses the first virtual point clockwise, wrapping to zero when needed.

Virtual nodes improve balance. Membership simulation samples 1,000 keys before and after a node change and reports remapping. With modulo hashing, changing the node count changes almost every assignment. With consistent hashing, only keys formerly owned by the affected ring ranges move.

The Docker deployment uses three independent Redis processes with separate ports and volumes. The cache is shared independently of the application process and survives application restarts. The default memory backend remains available for tests and zero-dependency local use. The Docker setup still runs on one host, so a production deployment would place Redis nodes on separate machines or availability zones and add replicas, health-aware ring membership, authentication, and encrypted connections.

## Deployment modes

| Mode | Command | Cache topology |
|---|---|---|
| Local/test | `npm start` | Four in-process logical nodes |
| Redis locally | `npm run redis:up` then `CACHE_BACKEND=redis npm start` | Three Redis containers on 6379/6380/6381 |
| Full Docker | `docker compose up --build` | Containerized app plus three Redis containers |

## Trending

Recent searches live in ten maps, each representing 30 seconds. Rotation clears the oldest bucket. For bucket age `a`, activity receives weight `0.9^a`.

```text
historical = log1p(count) / log1p(maxCount)
recent = weightedRecentCount / max(1, maximumWeightedRecentCount)
trendScore = 0.4 × historical + 0.6 × recent
```

Log normalization prevents the largest historical query from overwhelming everything else. Recent normalization lets a burst surface quickly. After five minutes, all burst buckets are gone and the query falls back to its historical contribution. Trend cache entries are cleared on rotation because scores can change even without new database writes.

## Complexity and trade-offs

| Operation | Complexity | Note |
|---|---:|---|
| Hash-ring routing | O(log V) | `V = 450` Redis virtual points |
| Warm suggestion | O(1) average | In-process cache lookup after hash routing |
| Cold popularity result | Indexed range + sort | SQLite primary-store fallback |
| Trend result | Candidate scoring + sort | Freshness is favored over minimum miss latency |
| Batch flush | O(U) | `U` unique buffered queries |

A production system could add distributed prefix indexes or precomputed top-K materializations. Trending candidates would normally be pre-aggregated by a stream processor rather than scored during a cache miss.

## Viva quick answers

- **Why SQLite prefix ranges?** The assignment requires cache misses to fall back to the primary store. The normalized primary key provides indexed prefix filtering while keeping the implementation locally reproducible.
- **Why eventual consistency?** Search count freshness tolerates seconds of delay; removing synchronous writes lowers submission latency and database pressure.
- **Why separate normalized/display values?** Matching and deduplication remain case-insensitive while the UI preserves human-friendly text.
- **Why include mode in cache keys?** The same prefix can have different rankings; sharing one key would return incorrect results.
- **Why are trend scores computed at read time?** Bucket age changes continuously, so permanently stored scores become stale without a search event.
- **What fails on a hard crash?** Buffered counts. SQLite data remains durable. A queue or WAL closes that gap in production.
