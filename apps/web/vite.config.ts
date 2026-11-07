import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs: the same build works at `/` and from any web-resource folder (Dynamics 365). Routing is hash-based.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Read the repo-root .env. Only VITE_* reaches the browser; server secrets there stay server-side.
  envDir: '../..',
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'jsdom', css: false },
});
