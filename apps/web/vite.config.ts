/// <reference types="vitest/config" />

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { requireApiUrl } from './config/environment.ts';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(
      requireApiUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL),
    ),
  },
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    maxWorkers: 4,
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    },
  },
}));
