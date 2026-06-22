const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { decodeTitle, extractTopQueries, isUsableTitle } = require('../dataset/import-wikimedia');

test('Wikimedia title decoding produces usable query text', () => {
  assert.equal(decodeTitle('Search_engine_(computing)'), 'Search engine (computing)');
  assert.equal(decodeTitle('New_York_City'), 'New York City');
  assert.equal(isUsableTitle('-'), false);
  assert.equal(isUsableTitle('Special:Search'), false);
  assert.equal(isUsableTitle('Search engine'), true);
});

test('Wikimedia extractor filters English pageviews and sorts by real counts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wikimedia-test-'));
  const gzipPath = path.join(directory, 'sample.gz');
  const lines = [
    'de Berlin 999 0',
    'en Search_engine 40 0',
    'en Search_engine_optimization 70 0',
    'en Special:Search 500 0',
    'en New_York_City 100 0'
  ].join('\n');
  fs.writeFileSync(gzipPath, zlib.gzipSync(lines));
  try {
    const { rows } = await extractTopQueries(gzipPath, 2);
    assert.deepEqual(rows.map((row) => [row.query, row.count]), [
      ['New York City', 100],
      ['Search engine optimization', 70]
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
