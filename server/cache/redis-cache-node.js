const { createClient } = require('redis');

class RedisCacheNode {
  constructor(id, url, { clientFactory = createClient } = {}) {
    this.id = id;
    this.url = url;
    this.client = clientFactory({ url });
    this.stats = { hits: 0, misses: 0, errors: 0 };
    this.client.on?.('error', (error) => {
      this.stats.errors += 1;
      console.error(`[REDIS] ${this.id}: ${error.message}`);
    });
  }

  async connect() {
    if (!this.client.isOpen) await this.client.connect();
    await this.client.ping();
  }

  async peek(key) {
    try {
      const value = await this.client.get(key);
      return value === null ? null : JSON.parse(value);
    } catch (error) {
      this.stats.errors += 1;
      console.error(`[REDIS] ${this.id} read failed: ${error.message}`);
      return null;
    }
  }

  async get(key) {
    const value = await this.peek(key);
    if (value === null) this.stats.misses += 1;
    else this.stats.hits += 1;
    return value;
  }

  async set(key, value, ttlMs) {
    try {
      await this.client.set(key, JSON.stringify(value), { PX: ttlMs });
      return true;
    } catch (error) {
      this.stats.errors += 1;
      console.error(`[REDIS] ${this.id} write failed: ${error.message}`);
      return false;
    }
  }

  async invalidate(keys) {
    if (!keys.length) return 0;
    try {
      return await this.client.del(keys);
    } catch (error) {
      this.stats.errors += 1;
      console.error(`[REDIS] ${this.id} invalidation failed: ${error.message}`);
      return 0;
    }
  }

  async invalidatePattern(pattern) {
    const keys = [];
    try {
      for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        keys.push(key);
      }
      return this.invalidate(keys);
    } catch (error) {
      this.stats.errors += 1;
      console.error(`[REDIS] ${this.id} scan failed: ${error.message}`);
      return 0;
    }
  }

  async snapshot() {
    let size = 0;
    let healthy = false;
    try {
      size = await this.client.dbSize();
      healthy = (await this.client.ping()) === 'PONG';
    } catch {
      this.stats.errors += 1;
    }
    return {
      id: this.id,
      url: this.url,
      size,
      healthy,
      ...this.stats
    };
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}

module.exports = RedisCacheNode;
