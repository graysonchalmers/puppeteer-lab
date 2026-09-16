import path from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const stampPath = path.resolve(__dirname, 'build-stamp.json');
const buildStamp = existsSync(stampPath)
  ? JSON.parse(readFileSync(stampPath, 'utf8')).stamp
  : 'dev/unknown';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp) },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
