import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: !!process.env.CI,
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
