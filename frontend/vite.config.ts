import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Бэкенд слушает :8080. Проксируем публичный API и служебные эндпоинты,
// чтобы в dev-режиме не разбираться с CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/stats': 'http://localhost:8080',
    },
  },
});