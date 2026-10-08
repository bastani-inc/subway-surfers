import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1024 },
  preview: { port: 4173, strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
