const fs = require('node:fs');
const QueryDatabase = require('./sqlite');
const config = require('../config');
const { normalizeQuery } = require('../lib/normalize');

function parseCsvLine(line) {
  const match = line.match(/^"((?:[^"]|"")*)",(\d+)$/);
  if (!match) throw new Error(`Invalid dataset row: ${line.slice(0, 120)}`);
  return {
    displayQuery: match[1].replaceAll('""', '"'),
    count: Number(match[2])
  };
}

function loadDataset(database, datasetPath = config.datasetPath, chunkSize = 10000, replaceExisting = false) {
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Dataset not found at ${datasetPath}. Run npm run download-data first.`);
  }
  const startedAt = performance.now();
  const lines = fs.readFileSync(datasetPath, 'utf8').trim().split('\n');
  if (replaceExisting) database.clear();
  let loaded = 0;
  for (let start = 1; start < lines.length; start += chunkSize) {
    const entries = lines.slice(start, start + chunkSize).map(parseCsvLine).map((row) => ({
      normalizedQuery: normalizeQuery(row.displayQuery),
      displayQuery: row.displayQuery,
      count: row.count,
      updatedAt: Date.now()
    }));
    database.bulkReplace(entries);
    loaded += entries.length;
  }
  console.log(`[LOADER] Loaded ${loaded.toLocaleString()} rows in ${(performance.now() - startedAt).toFixed(0)}ms`);
  return loaded;
}

if (require.main === module) {
  const database = new QueryDatabase(config.databasePath);
  try {
    loadDataset(database, config.datasetPath, 10000, process.argv.includes('--replace'));
    console.log(`[LOADER] Database contains ${database.getCount().toLocaleString()} queries`);
  } finally {
    database.close();
  }
}

module.exports = { loadDataset, parseCsvLine };
