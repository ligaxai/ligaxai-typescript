#!/usr/bin/env node
/**
 * Stamp a pre-release suffix onto every publishable workspace package, in place.
 *
 *   node scripts/snapshot-version.mjs dev.42      ->  0.1.0  becomes  0.1.0-dev.42
 *
 * Used by the `dev` release channel only; the result is published and never committed. Internal
 * `workspace:*` ranges are rewritten by pnpm at publish time, so only the `version` field changes.
 * The example app is skipped because it is private.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const suffix = process.argv[2];
if (!suffix || !/^[A-Za-z0-9.-]+$/.test(suffix)) {
  console.error('usage: node scripts/snapshot-version.mjs <suffix>   e.g. dev.42');
  process.exit(2);
}

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = resolve(ROOT, 'packages');
for (const name of readdirSync(dir)) {
  const file = resolve(dir, name, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  if (pkg.private) continue;
  const base = String(pkg.version).split('-')[0];
  pkg.version = `${base}-${suffix}`;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}@${pkg.version}`);
}
