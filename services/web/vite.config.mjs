import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API comes from the containerised web server on 4300.
// The proxy keeps the browser's Host header: the server refuses a POST whose
// Origin and Host differ, and the short string form would rewrite the Host.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:4300', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false },
});
