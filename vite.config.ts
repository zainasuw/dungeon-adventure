import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the same build runs on itch.io, GitHub Pages and
  // inside the portfolio.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
