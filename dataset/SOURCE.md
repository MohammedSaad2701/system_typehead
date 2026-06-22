# Dataset source

This project uses the open-source **Wikimedia Pageviews** dataset.

- Dataset documentation: https://dumps.wikimedia.org/other/pageviews/readme.html
- Exact source file: https://dumps.wikimedia.org/other/pageviews/2025/2025-01/pageviews-20250101-000000.gz
- Source period: January 1, 2025, 00:00 UTC hourly aggregate
- License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/

The source contains four space-separated fields:

```text
domain_code page_title count_views total_response_size
```

`dataset/import-wikimedia.js` retains English Wikipedia desktop rows (`domain_code = en`), decodes page titles, excludes administrative namespaces, maps `page_title` to `query`, maps `count_views` to `count`, and writes the 120,000 highest-count unique entries to `dataset/queries.csv`.

Run:

```bash
npm run download-data
```

The resulting CSV has the assignment's required format:

```csv
query,count
"Example page title",123
```
