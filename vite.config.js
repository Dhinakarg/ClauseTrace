import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // PDF.js is heavy and only needed once a PDF is opened.
          pdf: ['pdfjs-dist'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'src/**/__tests__/**/*.test.js'],
    globals: false,
  },
});
