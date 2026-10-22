#!/usr/bin/env node
/**
 * Publish every public workspace package with the **npm CLI**, under one dist-tag:
 *
 *   node scripts/publish-packages.mjs dev      # dev snapshots (after snapshot-version.mjs)
 *   node scripts/publish-packages.mjs latest   # stable (after `changeset version`)
 *
 * Why not `pnpm publish` / `changeset publish`: npm's trusted publishing (OIDC, provenance, no token)
 * is documented for `npm publish` with npm ≥ 11.5.1 and says nothing about other clients. So each
 * package is packed with pnpm — which rewrites `workspace:*` ranges to real versions — and the tarball
 * is published by npm.
 *
 * Idempotent: a version already on the registry is skipped, so a re-run after a partial failure
 * publishes only what is missing.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2];
if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag)) {
  console.error('usage: node scripts/publish-packages.mjs <dist-tag>');
  process.exit(2);
}

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function published(name, version) {
  try {
    const out = execFileSync(npm, ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === version;
  } catch {
    return false; // E404: not published yet
  }
}

// The client first: `@ligaxai/react` and `@ligaxai/widget` depend on the exact `@ligaxai/sdk` version
// being published, and must never be on the registry before it.
const dirs = readdirSync(join(ROOT, 'packages')).sort((a, b) =>
  a === 'sdk' ? -1 : b === 'sdk' ? 1 : a.localeCompare(b),
);
for (const dir of dirs) {
  const cwd = join(ROOT, 'packages', dir);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (pkg.private) continue;
  if (published(pkg.name, pkg.version)) {
    console.log(`${pkg.name}@${pkg.version} already published — skipped`);
    continue;
  }
  const packed = execFileSync(pnpm, ['pack', '--pack-destination', cwd], { cwd, encoding: 'utf8' })
    .trim()
    .split('\n')
    .pop();
  console.log(`publishing ${pkg.name}@${pkg.version} (${tag})`);
  execFileSync(npm, ['publish', packed, '--access', 'public', '--tag', tag], {
    cwd,
    stdio: 'inherit',
  });
}
