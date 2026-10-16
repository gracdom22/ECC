import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Thin network/DB adapters and the process entrypoint; exercised by the live smoke run, not unit tests.
      exclude: ['src/index.ts', 'src/clients/gamma.ts', 'src/clients/clob.ts', 'src/clients/oddsApi.ts', 'src/store/supabase.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
