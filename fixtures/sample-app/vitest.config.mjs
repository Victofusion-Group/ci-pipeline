import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright specs live in e2e/ and run under `npm run test:e2e`, not here.
    exclude: ['**/node_modules/**', 'e2e/**'],
    coverage: {
      enabled: !!process.env.CI,
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
