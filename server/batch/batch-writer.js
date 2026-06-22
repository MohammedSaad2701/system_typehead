class BatchWriter {
  constructor({ database, cache, metrics, maxUniqueQueries = 50, flushIntervalMs = 5000 }) {
    this.database = database;
    this.cache = cache;
    this.metrics = metrics;
    this.maxUniqueQueries = maxUniqueQueries;
    this.buffer = new Map();
    this.flushing = null;
    this.timer = setInterval(() => this.flush(), flushIntervalMs);
    this.timer.unref?.();
  }

  enqueue(normalizedQuery, displayQuery) {
    const existing = this.buffer.get(normalizedQuery);
    if (existing) existing.delta += 1;
    else this.buffer.set(normalizedQuery, { displayQuery, delta: 1 });
    this.metrics.searchSubmissions += 1;
    if (this.buffer.size >= this.maxUniqueQueries) void this.flush();
  }

  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.buffer.size) return {
      flushed: false,
      queriesWritten: 0,
      totalCounts: 0,
      writesSaved: 0
    };
    const pending = this.buffer;
    this.buffer = new Map();
    this.flushing = Promise.resolve().then(async () => {
      const now = Date.now();
      const entries = [...pending.entries()].map(([normalizedQuery, value]) => ({
        normalizedQuery,
        displayQuery: value.displayQuery,
        delta: value.delta,
        updatedAt: now
      }));
      const totalCounts = entries.reduce((sum, entry) => sum + entry.delta, 0);
      this.database.bulkUpsert(entries);
      await Promise.all(entries.map((entry) => this.cache.invalidateQuery(entry.normalizedQuery)));
      this.metrics.batchFlushes += 1;
      this.metrics.bufferedEventsFlushed += totalCounts;
      const result = {
        flushed: true,
        queriesWritten: entries.length,
        totalCounts,
        writesSaved: totalCounts - entries.length
      };
      console.log(`[BATCH] Flushed ${entries.length} queries / ${totalCounts} searches; saved ${result.writesSaved} row writes`);
      return result;
    }).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  getStats() {
    return {
      bufferSize: this.buffer.size,
      writeReductionRatio: this.metrics.batchFlushes
        ? Number((this.metrics.bufferedEventsFlushed / Math.max(1, this.database.getMetrics().rowsUpdated)).toFixed(2))
        : 0
    };
  }

  async close() {
    clearInterval(this.timer);
    return this.flush();
  }
}

module.exports = BatchWriter;
