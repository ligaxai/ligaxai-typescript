import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'widget',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
