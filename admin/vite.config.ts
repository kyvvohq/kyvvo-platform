import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A SPA é servida pelo kyvvo-platform sob /admin (ver ../index.js:
// @fastify/static + fallback de SPA). `base` precisa bater com esse prefixo
// pros assets buildados (/admin/assets/…) resolverem.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    // Dev: `npm run dev` aqui + `npm start` no platform (:3003). O Vite
    // encaminha a API e os assets do Design System pro serviço.
    proxy: {
      '/admin/api': 'http://localhost:3003',
      '/ds': 'http://localhost:3003',
    },
  },
});
