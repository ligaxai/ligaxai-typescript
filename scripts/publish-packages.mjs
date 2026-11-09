#!/usr/bin/env node
/**
 * Pack and publish every public workspace package with the **npm CLI**, under one dist-tag.
 *
 *   node scripts/publish-packages.mjs pack <dir>            # CI build job: pnpm-pack into <dir>
 *   node scripts/publish-packages.mjs publish <dir> <tag>   # CI publish job: npm-publish what <dir> holds
 *   node scripts/publish-packages.mjs release <tag>         # one machine: pack, then publish (first release)
 *
 * **Why two steps in CI.** The job that can publish (it holds the OIDC credential npm trusted
 * publishing turns into a publish token) must run as little code as possible: no `pnpm install`, no
 * build, no test, no dependency's lifecycle script — that is how 2025–2026 npm worms got release
 * rights. So the build job packs the tarballs and uploads them; the publish job only downloads them
 * and runs `npm publish` on each. `<dir>/manifest.json` says what was packed, in publish order.
 *
 * **Why npm, not pnpm/changesets publish.** Trusted publishing is documented for `npm publish` with
 * the npm CLI ≥ 11.5.1. pnpm still does the packing, because it rewrites `workspace:*` ranges to the
 * real versions.
 *
 * **Order.** `@ligaxai/sdk` first: the others depend on its exact version and must never be on the
 * registry before it.
 *
 * Every mode is spelled out (`release <tag>`, never a bare word) so a typo can never be read as a
 * dist-tag and published. Idempotent: a version already on the registry is skipped, so a re-run
 * after a partial failure publishes only what is missing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const TAGS = new Set(['dev', 'latest']);

function usage() {
  console.error(
    'usage: publish-packages.mjs pack <dir> | publish <dir> <dev|latest> | release <dev|latest>',
  );
  process.exit(2);
}

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

/** The version a dist-tag points at now, or null (unpublished, or no such tag). */
function distTag(name, tag) {
  try {
    const tags = JSON.parse(
      execFileSync(npm, ['view', name, 'dist-tags', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    return tags[tag] ?? null;
  } catch {
    return null;
  }
}

/**
 * Order `X.Y.Z` / `X.Y.Z-dev.N` versions — the only two shapes this repo publishes. A dev build
 * sorts below the release it previews, as in semver.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const [main, pre] = String(v).split('-');
    const nums = main.split('.').map((n) => Number.parseInt(n, 10) || 0);
    const dev = pre ? Number.parseInt(pre.replace(/^dev\./, ''), 10) || 0 : Infinity;
    return [...nums, dev];
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Public workspace packages, `sdk` first. */
function packages() {
  const dirs = readdirSync(join(ROOT, 'packages')).sort((a, b) =>
    a === 'sdk' ? -1 : b === 'sdk' ? 1 : a.localeCompare(b),
  );
  const out = [];
  for (const dir of dirs) {
    const cwd = join(ROOT, 'packages', dir);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!pkg.private) out.push({ cwd, name: pkg.name, version: pkg.version });
  }
  return out;
}

function pack(dir) {
  const dest = resolve(dir);
  mkdirSync(dest, { recursive: true });
  const manifest = [];
  for (const { cwd, name, version } of packages()) {
    const packed = execFileSync(pnpm, ['pack', '--pack-destination', dest], {
      cwd,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .pop();
    manifest.push({ name, version, file: basename(packed) });
    console.log(`packed ${name}@${version}`);
  }
  writeFileSync(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function publish(dir, tag) {
  const src = resolve(dir);
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  for (const { name, version, file } of manifest) {
    // The manifest comes from our own build job; even so, each entry only ever becomes a path
    // inside <dir> and an argv entry — never a shell string — and must look like ours.
    if (!/^@ligaxai\/[a-z0-9-]+$/.test(name) || !/^[\w.+-]+\.tgz$/.test(file)) {
      throw new Error(`unexpected manifest entry: ${JSON.stringify({ name, file })}`);
    }
    // A dev snapshot must never go out as `latest`, nor a stable version under `dev`.
    if ((tag === 'dev') !== /-dev\./.test(version)) {
      throw new Error(`${name}@${version} does not belong under the "${tag}" dist-tag`);
    }
    if (published(name, version)) {
      console.log(`${name}@${version} already published — skipped`);
      continue;
    }
    // A dist-tag must only move forward: publishing an older build under `dev` (or `latest`)
    // would hand every `@dev` install a downgrade. Refuse rather than publish.
    const current = distTag(name, tag);
    if (current && compareVersions(version, current) <= 0) {
      throw new Error(
        `${name}@${version} is not newer than the current "${tag}" (${current}); refusing to publish`,
      );
    }
    console.log(`publishing ${name}@${version} (${tag})`);
    execFileSync(npm, ['publish', join(src, file), '--access', 'public', '--tag', tag], {
      stdio: 'inherit',
    });
  }
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'pack' && a && !b) pack(a);
else if (mode === 'publish' && a && TAGS.has(b)) publish(a, b);
else if (mode === 'release' && TAGS.has(a) && !b) {
  const dir = join(ROOT, '.release-tarballs');
  pack(dir);
  publish(dir, a);
} else usage();
