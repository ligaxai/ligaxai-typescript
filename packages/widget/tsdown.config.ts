import { defineConfig } from 'tsdown';

export default defineConfig([
  // (a) library build for bundler users: the SDK stays a dependency, resolved by their bundler.
  {
    entry: { index: 'src/index.ts', react: 'src/react.ts' },
    format: ['esm', 'cjs'],
    fixedExtension: true,
    platform: 'browser',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    clean: true,
    deps: { neverBundle: [/^@ligaxai\//, 'react'] },
  },
  // (b) one self-contained script for a <script> tag: everything inlined, global name derived
  // from the class prefix.
  {
    entry: { 'widget.global': 'src/global.ts' },
    format: 'iife',
    globalName: 'LigaXWidget',
    platform: 'browser',
    target: 'es2020',
    dts: false,
    minify: true,
    sourcemap: true,
    clean: false,
    deps: { alwaysBundle: /.*/, onlyBundle: false },
    outputOptions: { entryFileNames: 'widget.global.js' },
  },
]);
