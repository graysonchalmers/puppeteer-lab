// Process entry: env -> config -> store -> http server.
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';

const config = loadConfig();
const store = createStore({ dataDir: config.dataDir, linkTtlMs: config.linkTtlMs });
const server = http.createServer(createApp({ config, store }));
// A slow mobile upload of a ~16 MB gzip still fits in 180 s; stalled clients must not hold the only upload slot for Node's default 5 minutes.
server.requestTimeout = 180_000;

server.listen(config.port, config.host, () => {
  console.log(`[mocap] listening on ${config.host}:${config.port}, data in ${config.dataDir}`);
  if (!config.contactEmail) console.warn('[mocap] CONTACT_EMAIL is unset: uploads are refused until it is set');
  if (!config.adminToken) console.warn('[mocap] ADMIN_TOKEN is unset: the admin endpoints are off');
  if (!process.env.IP_SALT) console.warn('[mocap] IP_SALT is unset: IP hashes use a public default salt');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
