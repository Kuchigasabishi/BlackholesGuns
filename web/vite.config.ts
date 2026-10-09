import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.GAME_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    // The shared engine/protocol live outside web/.
    fs: { allow: ['..'] },
    proxy: {
      '/socket.io': { target: server, ws: true },
      '/api': server,
    },
  },
});
