const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../server/config');

const benchmarkPort = Number(process.env.BENCHMARK_PORT || 3210);
const baseUrl = `http://127.0.0.1:${benchmarkPort}`;
const prefixes = ['i', 'ip', 'iph', 'iphone', 'sys', 'system', 'best', 'travel', 'tech', 'healthy'];

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent / 100) - 1)];
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/stats`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not start in time');
}

async function runRequests(rounds) {
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const prefix of prefixes) {
      const start = performance.now();
      const response = await fetch(`${baseUrl}/suggest?q=${encodeURIComponent(prefix)}`);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      await response.json();
      samples.push(performance.now() - start);
    }
  }
  return samples;
}

async function main() {
  if (!fs.existsSync(config.databasePath)) {
    throw new Error('Database not found. Run npm run setup before benchmarking.');
  }
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'typeahead-benchmark-'));
  const temporaryDatabase = path.join(temporaryDirectory, 'typeahead.db');
  fs.copyFileSync(config.databasePath, temporaryDatabase);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: config.root,
    env: {
      ...process.env,
      CACHE_BACKEND: 'memory',
      DB_PATH: temporaryDatabase,
      PORT: String(benchmarkPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  try {
    await waitForServer();
    const cold = await runRequests(1);
    const warm = await runRequests(20);
    for (let index = 0; index < 100; index += 1) {
      await fetch(`${baseUrl}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: index % 2 ? 'Apple' : 'Jimmy Carter' })
      });
    }
    await fetch(`${baseUrl}/flush`, { method: 'POST' });
    const stats = await fetch(`${baseUrl}/stats`).then((response) => response.json());
    const report = {
      measuredAt: new Date().toISOString(),
      environment: { node: process.version, platform: process.platform, architecture: process.arch },
      requestLatencyMs: {
        coldP95: Number(percentile(cold, 95).toFixed(3)),
        warmP50: Number(percentile(warm, 50).toFixed(3)),
        warmP95: Number(percentile(warm, 95).toFixed(3)),
        warmP99: Number(percentile(warm, 99).toFixed(3))
      },
      serverMetrics: stats,
      rankingDemo: {
        note: 'Popular mode uses overall count; trend mode incorporates recent POST /search activity.',
        popular: await fetch(`${baseUrl}/suggest?q=app&mode=count`).then((response) => response.json()),
        trending: await fetch(`${baseUrl}/suggest?q=app&mode=trend`).then((response) => response.json())
      }
    };
    const outputPath = path.join(config.root, 'docs', 'benchmark-results.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[BENCHMARK] Results written to ${outputPath}`);
    console.log(JSON.stringify(report.requestLatencyMs, null, 2));
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
