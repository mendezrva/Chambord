import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any folder or static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  // In development the game server runs separately (npm run dev:server); pass its socket through.
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
