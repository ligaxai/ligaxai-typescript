import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// One entry per subpath in package.json "exports". `fixedExtension` keeps the ".mjs"/".cjs" pair
// unambiguous regardless of the consumer's own "type" field.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    errors: 'src/errors.ts',
    webhooks: 'src/webhooks.ts',
    next: 'src/next.ts',
    'ai-sdk': 'src/ai-sdk.ts',
  },
  format: ['esm', 'cjs'],
  fixedExtension: true,
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // The User-Agent version is stamped from package.json so it can never drift from npm.
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  // Optional peers are type-only imports; they must never be bundled or required at runtime.
  deps: { neverBundle: ['ai', 'next'] },
  // `index` has both a default and named exports (openai-node convention); CJS users reach the
  // default via `.default`, which is the documented shape.
  outputOptions: { exports: 'named' },
});
