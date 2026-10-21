import { defineConfig } from 'vitest/config';

// One root run covers every package; each package's own vitest.config.ts sets its environment.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});
