import { defineConfig } from 'vite';
import { localAI } from './server/vite-ai.js';

export default defineConfig({
  base: './',
  plugins: [localAI()],
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ['three'], icons: ['lucide'] } },
    },
  },
});
