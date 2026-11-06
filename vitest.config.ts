import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests boot an in-memory replica set; give the first download room.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    setupFiles: ['./src/test/env.ts'],
  },
});
