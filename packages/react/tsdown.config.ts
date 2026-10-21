import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  fixedExtension: true,
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // Peers and the sibling SDK are resolved by the consumer's bundler, never inlined.
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'ai', '@ai-sdk/react', /^@base-project-scope\//],
  },
});
