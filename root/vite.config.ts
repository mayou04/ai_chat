import { defineConfig } from "vite";

// https://vite.dev/config/
// vite.config.js
export default defineConfig({
  server: {
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
