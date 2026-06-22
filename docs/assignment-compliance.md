# Assignment compliance checklist

This checklist maps the submitted implementation directly to the supplied assignment.

## Dataset requirement

- Uses the open Wikimedia Pageviews dataset under CC0.
- Uses page titles as queries and hourly page views as counts.
- Produces `query,count` CSV input.
- Loads 120,000 unique queries, exceeding the 100,000 minimum.
- Documents the exact source, license, transformation, and loading command in `dataset/SOURCE.md`.

## Functional requirements

- `GET /suggest?q=<prefix>` returns at most 10 suggestions.
- Popular mode returns only prefix matches sorted by count descending.
- Empty, missing, mixed-case, oversized, and unmatched inputs are handled.
- The UI debounces requests by 300 ms and aborts stale requests.
- `POST /search` returns `{ "message": "Searched" }` with the submitted query.
- Existing counts increase; unseen queries are inserted with count 1 on batch flush.
- Updates invalidate affected prefix caches and become visible in suggestions/trending.

## Storage and distributed caching

- SQLite stores normalized query, display query, count, and update time.
- Suggestion reads check the cache before querying SQLite.
- Prefix results expire after 60 seconds.
- Three independent Redis containers are routed through a 450-point application-level consistent-hash ring.
- A four-node in-process backend remains available as a zero-dependency fallback.
- `/cache/debug` reports assigned node and current hit/miss state.
- Development node-add/remove simulation reports the percentage of remapped keys.

## Trending searches

- Ten 30-second buckets track five minutes of recent submissions.
- Bucket activity decays by `0.9^age`.
- Ranking combines 40% log-normalized historical count and 60% normalized recent activity.
- Expired buckets remove short-lived popularity from the recent score.
- Trend cache entries are invalidated on relevant searches, batch flushes, and bucket rotation.
- The same `/suggest` API supports basic and enhanced ranking via `mode=count|trend`.
- `docs/benchmark-results.json` records a popular-versus-trending example.

## Batch writes

- Search submissions enter an in-memory map and repeated queries are aggregated.
- Flush occurs every five seconds or at 50 unique buffered queries.
- One SQLite transaction writes all unique rows in a batch.
- Metrics and logs show submitted events, rows updated, transactions, and write reduction.
- Graceful shutdown flushes the buffer; abrupt-crash loss and durable-queue mitigation are documented.

## UI and non-functional requirements

- Search input, suggestion dropdown, Enter/button submission, response display, trending section, loading/error states, and arrow-key navigation are implemented.
- `/stats` reports p50/p95/p99 latency, cache hit rate, database reads/writes, batch metrics, and dataset size.
- Tests cover the dataset importer, prefix ordering, case handling, caching, hashing, trending decay, batching, and APIs.
- Setup, architecture, API documentation, design trade-offs, benchmark results, and viva explanations are included.
