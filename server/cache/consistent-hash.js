const crypto = require('node:crypto');

class ConsistentHashRing {
  constructor(virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    this.ring = [];
  }

  hash(value) {
    const digest = crypto.createHash('md5').update(value).digest();
    return digest.readUInt32BE(0);
  }

  addNode(nodeId) {
    if (this.ring.some((point) => point.nodeId === nodeId)) return;
    for (let index = 0; index < this.virtualNodes; index += 1) {
      this.ring.push({ position: this.hash(`${nodeId}#${index}`), nodeId });
    }
    this.ring.sort((a, b) => a.position - b.position);
  }

  removeNode(nodeId) {
    this.ring = this.ring.filter((point) => point.nodeId !== nodeId);
  }

  locate(key) {
    if (!this.ring.length) throw new Error('No cache nodes are available');
    const hashValue = this.hash(key);
    let low = 0;
    let high = this.ring.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.ring[middle].position < hashValue) low = middle + 1;
      else high = middle;
    }
    const ringIndex = low === this.ring.length ? 0 : low;
    return { hashValue, ringIndex, ...this.ring[ringIndex] };
  }

  getDistribution() {
    const ownership = {};
    if (!this.ring.length) return ownership;
    const circumference = 2 ** 32;
    for (let index = 0; index < this.ring.length; index += 1) {
      const current = this.ring[index];
      const previous = this.ring[(index - 1 + this.ring.length) % this.ring.length];
      const distance = current.position >= previous.position
        ? current.position - previous.position
        : circumference - previous.position + current.position;
      ownership[current.nodeId] = (ownership[current.nodeId] || 0) + distance;
    }
    return Object.fromEntries(
      Object.entries(ownership).map(([node, distance]) => [
        node,
        Number(((distance / circumference) * 100).toFixed(2))
      ])
    );
  }
}

module.exports = ConsistentHashRing;
