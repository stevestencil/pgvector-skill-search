import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/logger.ts',
        'src/interfaces/**',
      ],
    },
  },
});
