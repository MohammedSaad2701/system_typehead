class Metrics {
  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
    this.suggestionLatencies = [];
    this.totalRequests = 0;
    this.searchSubmissions = 0;
    this.batchFlushes = 0;
    this.bufferedEventsFlushed = 0;
  }

  middleware() {
    return (request, response, next) => {
      this.totalRequests += 1;
      next();
    };
  }

  recordSuggestion(milliseconds) {
    this.suggestionLatencies.push(milliseconds);
    if (this.suggestionLatencies.length > this.maxSamples) this.suggestionLatencies.shift();
  }

  percentile(percent) {
    if (!this.suggestionLatencies.length) return 0;
    const sorted = [...this.suggestionLatencies].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
    return Number(sorted[index].toFixed(3));
  }

  snapshot() {
    return {
      totalRequests: this.totalRequests,
      suggestionSamples: this.suggestionLatencies.length,
      latencyMs: {
        p50: this.percentile(50),
        p95: this.percentile(95),
        p99: this.percentile(99)
      },
      searchSubmissions: this.searchSubmissions,
      batchFlushes: this.batchFlushes,
      bufferedEventsFlushed: this.bufferedEventsFlushed
    };
  }
}

module.exports = Metrics;
