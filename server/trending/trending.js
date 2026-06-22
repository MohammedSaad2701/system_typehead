class TrendingManager {
  constructor({
    bucketCount = 10,
    bucketDurationMs = 30000,
    decay = 0.9,
    historicalWeight = 0.4,
    recentWeight = 0.6,
    onRotate = () => {}
  } = {}) {
    this.bucketCount = bucketCount;
    this.decay = decay;
    this.historicalWeight = historicalWeight;
    this.recentWeight = recentWeight;
    this.buckets = Array.from({ length: bucketCount }, () => new Map());
    this.currentIndex = 0;
    this.onRotate = onRotate;
    this.timer = setInterval(() => this.rotate(), bucketDurationMs);
    this.timer.unref?.();
  }

  recordSearch(normalizedQuery) {
    const bucket = this.buckets[this.currentIndex];
    bucket.set(normalizedQuery, (bucket.get(normalizedQuery) || 0) + 1);
  }

  rotate() {
    this.currentIndex = (this.currentIndex + 1) % this.bucketCount;
    this.buckets[this.currentIndex].clear();
    Promise.resolve(this.onRotate()).catch((error) => {
      console.error(`[TRENDING] Rotation callback failed: ${error.message}`);
    });
  }

  getWeightedRecentCounts() {
    const totals = new Map();
    for (let age = 0; age < this.bucketCount; age += 1) {
      const index = (this.currentIndex - age + this.bucketCount) % this.bucketCount;
      const weight = this.decay ** age;
      for (const [query, count] of this.buckets[index]) {
        totals.set(query, (totals.get(query) || 0) + count * weight);
      }
    }
    return totals;
  }

  computeTrendScore(normalizedQuery, count, maxCount, recentCounts) {
    const counts = recentCounts || this.getWeightedRecentCounts();
    const maxRecent = Math.max(1, ...counts.values());
    const historical = Math.log1p(count) / Math.log1p(Math.max(1, maxCount));
    const recent = (counts.get(normalizedQuery) || 0) / maxRecent;
    return Number((this.historicalWeight * historical + this.recentWeight * recent).toFixed(6));
  }

  rankEntries(entries, maxCount, recentCounts = this.getWeightedRecentCounts(), limit = 10) {
    return entries
      .map((entry) => ({
        ...entry,
        trendScore: this.computeTrendScore(
          entry.normalizedQuery,
          entry.count,
          maxCount,
          recentCounts
        )
      }))
      .sort((a, b) => b.trendScore - a.trendScore || b.count - a.count || a.query.localeCompare(b.query))
      .slice(0, limit);
  }

  getTrending(database, limit = 10) {
    const recentCounts = this.getWeightedRecentCounts();
    const recentCandidates = [...recentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([query]) => query);
    const entries = new Map();
    for (const entry of database.getSuggestions('', limit * 3, limit * 3)) {
      entries.set(entry.normalizedQuery, entry);
    }
    for (const entry of database.getQueries(recentCandidates)) {
      entries.set(entry.normalizedQuery, entry);
    }
    return this.rankEntries([...entries.values()], database.getMaxCount(), recentCounts, limit);
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = TrendingManager;
