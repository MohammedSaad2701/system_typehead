const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const zlib = require('node:zlib');
const readline = require('node:readline');
const { pipeline } = require('node:stream/promises');
const config = require('../server/config');
const { normalizeQuery } = require('../server/lib/normalize');

class MinHeap {
  constructor() {
    this.values = [];
  }

  push(value) {
    this.values.push(value);
    this.bubbleUp(this.values.length - 1);
  }

  replaceRoot(value) {
    this.values[0] = value;
    this.bubbleDown(0);
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].count <= this.values[index].count) break;
      [this.values[parent], this.values[index]] = [this.values[index], this.values[parent]];
      index = parent;
    }
  }

  bubbleDown(index) {
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;
      if (left < this.values.length && this.values[left].count < this.values[smallest].count) smallest = left;
      if (right < this.values.length && this.values[right].count < this.values[smallest].count) smallest = right;
      if (smallest === index) return;
      [this.values[index], this.values[smallest]] = [this.values[smallest], this.values[index]];
      index = smallest;
    }
  }
}

function download(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'user-agent': 'SearchTypeaheadAssignment/1.0 (educational dataset importer)' }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Dataset download failed with HTTP ${response.statusCode}`));
        return;
      }
      pipeline(response, fs.createWriteStream(destination)).then(resolve, reject);
    });
    request.on('error', reject);
  });
}

function decodeTitle(encodedTitle) {
  try {
    return decodeURIComponent(encodedTitle).replaceAll('_', ' ').trim().replace(/\s+/g, ' ');
  } catch {
    return null;
  }
}

function isUsableTitle(title) {
  return title
    && title !== '-'
    && title.length <= config.maxQueryLength
    && !title.includes(':')
    && !title.startsWith('Main Page')
    && !title.startsWith('Special:');
}

async function extractTopQueries(gzipPath, limit = config.datasetSize) {
  const heap = new MinHeap();
  const heapLimit = limit + 10000;
  const stream = fs.createReadStream(gzipPath).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let englishRows = 0;

  for await (const line of lines) {
    const firstSpace = line.indexOf(' ');
    if (firstSpace === -1 || line.slice(0, firstSpace) !== 'en') continue;
    const secondSpace = line.indexOf(' ', firstSpace + 1);
    const thirdSpace = line.indexOf(' ', secondSpace + 1);
    if (secondSpace === -1 || thirdSpace === -1) continue;
    const title = decodeTitle(line.slice(firstSpace + 1, secondSpace));
    const count = Number(line.slice(secondSpace + 1, thirdSpace));
    if (!isUsableTitle(title) || !Number.isInteger(count) || count < 1) continue;
    const normalizedQuery = normalizeQuery(title);
    if (!normalizedQuery) continue;
    englishRows += 1;
    const entry = { query: title, normalizedQuery, count };
    if (heap.values.length < heapLimit) heap.push(entry);
    else if (count > heap.values[0].count) heap.replaceRoot(entry);
  }

  const deduplicated = new Map();
  for (const entry of heap.values) {
    const existing = deduplicated.get(entry.normalizedQuery);
    if (!existing || entry.count > existing.count) deduplicated.set(entry.normalizedQuery, entry);
  }
  const rows = [...deduplicated.values()].sort((a, b) => b.count - a.count || a.query.localeCompare(b.query));
  const minimumRows = Math.min(100000, limit);
  if (rows.length < minimumRows) {
    throw new Error(`Only ${rows.length} unique queries were extracted; at least ${minimumRows} are required`);
  }
  return { rows: rows.slice(0, limit), englishRows };
}

function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function importWikimedia({ force = false } = {}) {
  const metadataPath = config.datasetMetadataPath;
  if (!force && fs.existsSync(config.datasetPath) && fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.sourceUrl === config.datasetSourceUrl && metadata.rows >= 100000) {
      console.log(`[DATASET] Reusing ${metadata.rows.toLocaleString()} Wikimedia rows from ${config.datasetPath}`);
      return metadata;
    }
  }

  const archivePath = path.join(config.root, 'data', path.basename(config.datasetSourceUrl));
  if (!fs.existsSync(archivePath)) {
    console.log(`[DATASET] Downloading Wikimedia Pageviews from ${config.datasetSourceUrl}`);
    await download(config.datasetSourceUrl, archivePath);
  }

  console.log('[DATASET] Extracting the top English Wikipedia page titles...');
  const { rows, englishRows } = await extractTopQueries(archivePath);
  fs.mkdirSync(path.dirname(config.datasetPath), { recursive: true });
  const csv = ['query,count', ...rows.map((row) => `${escapeCsv(row.query)},${row.count}`)].join('\n');
  fs.writeFileSync(config.datasetPath, `${csv}\n`);
  const metadata = {
    name: 'Wikimedia Pageviews',
    sourceUrl: config.datasetSourceUrl,
    documentation: 'https://dumps.wikimedia.org/other/pageviews/readme.html',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourcePeriod: '2025-01-01 00:00 UTC hourly aggregate',
    projectFilter: 'en.wikipedia.org desktop (domain code: en)',
    transformation: 'page_title becomes query; count_views becomes count; top entries retained by count',
    rows: rows.length,
    sourceEnglishRowsRead: englishRows,
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`[DATASET] Wrote ${rows.length.toLocaleString()} open-source queries to ${config.datasetPath}`);
  return metadata;
}

if (require.main === module) {
  importWikimedia({ force: process.argv.includes('--force') }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { MinHeap, decodeTitle, extractTopQueries, importWikimedia, isUsableTitle };
