import path from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const stampPath = path.resolve(__dirname, 'build-stamp.json');
const buildStamp = existsSync(stampPath)
  ? JSON.parse(readFileSync(stampPath, 'utf8')).stamp
  : 'dev/unknown';

const apiTarget = process.env.MOCAP_API || 'http://127.0.0.1:8787';
const apiProxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp),
    // Compile-time flag for the topology comparison sheet only (components/face/topoSheetHook.ts); false in normal builds.
    __TOPO_SHEET__: JSON.stringify(process.env.VITE_TOPO_SHEET === '1'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
