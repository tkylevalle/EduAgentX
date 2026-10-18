import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API comes from the containerised web server on 4300.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4300' } },
  build: { outDir: 'dist', sourcemap: false },
});
