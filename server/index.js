const config = require('./config');
const createApp = require('./app');
const { createServices, closeServices } = require('./services');

let shuttingDown = false;
let services;
let server;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] ${signal} received; flushing buffered searches...`);
  server.close(async () => {
    try {
      await closeServices(services);
      process.exitCode = 0;
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function start() {
  services = await createServices();
  const app = createApp(services);
  server = app.listen(config.port, () => {
    console.log(`[SERVER] Search Typeahead running at http://localhost:${config.port}`);
    console.log(`[CACHE] Backend: ${config.cache.backend}`);
  });
  return { app, services, server };
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`[STARTUP] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { start };
