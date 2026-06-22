const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

class QueryDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.metrics = { reads: 0, transactions: 0, rowsUpdated: 0 };
    this.createSchema();
    this.prepareStatements();
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queries (
        normalized_query TEXT PRIMARY KEY,
        display_query TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queries_count
        ON queries(count DESC);
    `);
  }

  prepareStatements() {
    this.upsertStatement = this.db.prepare(`
      INSERT INTO queries(normalized_query, display_query, count, updated_at)
      VALUES (@normalizedQuery, @displayQuery, @delta, @updatedAt)
      ON CONFLICT(normalized_query) DO UPDATE SET
        count = queries.count + excluded.count,
        updated_at = excluded.updated_at
    `);
    this.replaceStatement = this.db.prepare(`
      INSERT INTO queries(normalized_query, display_query, count, updated_at)
      VALUES (@normalizedQuery, @displayQuery, @count, @updatedAt)
      ON CONFLICT(normalized_query) DO UPDATE SET
        display_query = excluded.display_query,
        count = excluded.count,
        updated_at = excluded.updated_at
    `);
    this.bulkUpsertTransaction = this.db.transaction((entries) => {
      for (const entry of entries) this.upsertStatement.run(entry);
    });
    this.bulkReplaceTransaction = this.db.transaction((entries) => {
      for (const entry of entries) this.replaceStatement.run(entry);
    });
  }

  bulkUpsert(entries) {
    if (!entries.length) return 0;
    this.bulkUpsertTransaction(entries);
    this.metrics.transactions += 1;
    this.metrics.rowsUpdated += entries.length;
    return entries.length;
  }

  bulkReplace(entries) {
    if (!entries.length) return 0;
    this.bulkReplaceTransaction(entries);
    this.metrics.transactions += 1;
    this.metrics.rowsUpdated += entries.length;
    return entries.length;
  }

  getAllQueries() {
    this.metrics.reads += 1;
    return this.db.prepare(`
      SELECT normalized_query AS normalizedQuery,
             display_query AS displayQuery,
             count
      FROM queries
    `).all();
  }

  clear() {
    this.db.exec('DELETE FROM queries');
  }

  getSuggestions(prefix, limit = 10, candidateLimit = limit) {
    this.metrics.reads += 1;
    const upperBound = `${prefix}\uffff`;
    return this.db.prepare(`
      SELECT normalized_query AS normalizedQuery,
             display_query AS query,
             count
      FROM queries
      WHERE normalized_query >= ? AND normalized_query < ?
      ORDER BY count DESC, display_query ASC
      LIMIT ?
    `).all(prefix, upperBound, candidateLimit).slice(0, limit);
  }

  getQueries(normalizedQueries) {
    if (!normalizedQueries.length) return [];
    this.metrics.reads += 1;
    const output = [];
    for (let start = 0; start < normalizedQueries.length; start += 500) {
      const chunk = normalizedQueries.slice(start, start + 500);
      const placeholders = chunk.map(() => '?').join(',');
      output.push(...this.db.prepare(`
        SELECT normalized_query AS normalizedQuery,
               display_query AS query,
               count
        FROM queries
        WHERE normalized_query IN (${placeholders})
      `).all(...chunk));
    }
    return output;
  }

  getMaxCount() {
    this.metrics.reads += 1;
    return this.db.prepare('SELECT COALESCE(MAX(count), 1) AS count FROM queries').get().count;
  }

  getCount() {
    this.metrics.reads += 1;
    return this.db.prepare('SELECT COUNT(*) AS count FROM queries').get().count;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  close() {
    this.db.close();
  }
}

module.exports = QueryDatabase;
