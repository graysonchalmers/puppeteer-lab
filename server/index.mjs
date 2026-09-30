// Process entry: env -> config -> store -> http server.
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';

const config = loadConfig();
const store = createStore({ dataDir: config.dataDir, linkTtlMs: config.linkTtlMs });
const server = http.createServer(createApp({ config, store }));

server.listen(config.port, config.host, () => {
  console.log(`[mocap] listening on ${config.host}:${config.port}, data in ${config.dataDir}`);
  if (!config.contactEmail) console.warn('[mocap] CONTACT_EMAIL is unset: uploads are refused until it is set');
  if (!config.adminToken) console.warn('[mocap] ADMIN_TOKEN is unset: the admin endpoints are off');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
