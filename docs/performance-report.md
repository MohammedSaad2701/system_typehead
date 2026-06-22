# Performance Report

## Reproducing measurements

Run:

```bash
npm run setup
npm run benchmark
```

The benchmark starts the service, sends one cold round and twenty warm rounds across ten prefixes, submits 100 repeated searches, flushes the batch, and writes machine-readable results to `docs/benchmark-results.json`.

The report intentionally records measured results rather than claiming fixed latency across different machines. The browser dashboard's `/stats` figures measure server-side suggestion handling, while the benchmark also measures local HTTP round-trip time.

## Recorded run

Measured on June 22, 2026 using Node.js 22.18.0 on Apple Silicon and the 120,000-row Wikimedia dataset:

| Measurement | Result |
|---|---:|
| Dataset load | 377 ms |
| Cold HTTP p95 | 2.875 ms |
| Warm HTTP p50 | 0.203 ms |
| Warm HTTP p95 | 0.369 ms |
| Warm HTTP p99 | 0.506 ms |
| Server-side suggestion p95 | see `benchmark-results.json` |
| Cache hit rate | 95.24% |
| Database reads during benchmark | 12 |
| Batch transactions | 1 |
| Search events flushed | 100 |
| Database rows updated | 2 |
| Write reduction | 50:1 |

These numbers use the memory backend so the benchmark remains reproducible on machines without Docker. The Redis backend adds local network serialization and should be measured separately on a Docker-enabled machine. The checked-in `docs/benchmark-results.json` contains full output and a ranking demonstration. The benchmark runs against a temporary SQLite copy, so it never changes the submission database.

## Metrics

- **p50/p95/p99:** Calculated from the latest 1,000 suggestion requests.
- **Cache hit rate:** Hits divided by all cache lookups. Empty prefixes do not affect it.
- **Database reads:** Startup scans and count checks.
- **Database transactions:** Batch units, not individual SQL rows.
- **Rows updated:** Unique query rows written across transactions.
- **Write reduction:** Search events flushed divided by unique rows updated.
- **Distribution:** Percentage of the 32-bit hash ring owned by each active node.

## Expected interpretation

- The first request for each prefix is a miss and reads the SQLite primary store.
- Repeating the same prefixes should produce near-100% cache hits until TTL expiry.
- One hundred submissions split between two queries should write two rows in one transaction, a 50:1 event-to-row ratio.
- Adding a fifth cache node should remap a minority of sample keys, normally near 20%.

## Limitations

This is a single-process memory-backend benchmark, not a capacity test. The Docker Compose Redis deployment demonstrates independent processes but still shares one physical host. Results demonstrate relative behavior—cold versus warm reads and direct versus batched writes—not Google-scale throughput.
