#!/usr/bin/env node
/**
 * Stamp a pre-release suffix onto every publishable workspace package, in place.
 *
 *   node scripts/snapshot-version.mjs dev.42      ->  0.1.0  becomes  0.1.0-dev.42
 *
 * **The base is the version the pending changesets will release, not the committed one.** Before
 * a package's first stable release its `package.json` says `0.0.0`, and stamping that produced
 * `0.0.0-dev.10` for code whose changesets already say "minor" — a pre-release of a version that
 * will never exist, which also sorts *below* every real release. So the highest bump any pending
 * changeset (`.changeset/*.md`) names for a package is applied first: `0.0.0` + minor →
 * `0.1.0-dev.42`, which sorts just before the `0.1.0` it previews.
 *
 * Used by the `dev` release channel only; the result is published and never committed. Internal
 * `workspace:*` ranges are rewritten by pnpm at publish time, so only the `version` field changes.
 * The example app is skipped because it is private.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const suffix = process.argv[2];
if (!suffix || !/^[A-Za-z0-9.-]+$/.test(suffix)) {
  console.error('usage: node scripts/snapshot-version.mjs <suffix>   e.g. dev.42');
  process.exit(2);
}

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const RANK = { patch: 1, minor: 2, major: 3 };

/** package name → highest pending bump, read from the changeset front matter. */
function pendingBumps() {
  const bumps = new Map();
  const dir = resolve(ROOT, '.changeset');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return bumps;
  }
  for (const file of files) {
    const text = readFileSync(resolve(dir, file), 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!front) continue;
    for (const line of front[1].split(/\r?\n/)) {
      const m = /^\s*['"]?([^'":]+)['"]?\s*:\s*(patch|minor|major)\s*$/.exec(line);
      if (!m) continue;
      const [, name, bump] = m;
      if ((RANK[bump] ?? 0) > (RANK[bumps.get(name)] ?? 0)) bumps.set(name, bump);
    }
  }
  return bumps;
}

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split('.').map((n) => Number.parseInt(n, 10) || 0);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  return version;
}

/** `[major, minor, patch]` of a version, ignoring any pre-release suffix. */
const core = (v) =>
  String(v)
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
const cmpCore = (a, b) => {
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const fmt = (parts) => parts.join('.');

/**
 * The lowest base a new snapshot may use, from what the registry already holds.
 *
 * **Snapshots must only ever go up.** The changeset-derived base can fall behind the registry —
 * once the pending changesets are consumed, or after a stable release — and `0.0.1-dev.40` sorts
 * *below* an already-published `0.1.0-dev.31`, so `@dev` would silently go backwards. The floor is
 * the base of the current `dev` dist-tag, and the next patch after the current stable `latest`.
 * Offline (a local run), there is no floor and the changeset base stands.
 */
function registryFloor(name) {
  let tags;
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    tags = JSON.parse(
      execFileSync(npm, ['view', name, 'dist-tags', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return null; // not published yet, or no network
  }
  let floor = null;
  if (tags.dev) floor = fmt(core(tags.dev));
  if (tags.latest && !String(tags.latest).includes('-')) {
    const [a, b, c] = core(tags.latest);
    const next = fmt([a, b, c + 1]);
    if (!floor || cmpCore(next, floor) > 0) floor = next;
  }
  return floor;
}

const bumps = pendingBumps();
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
  let base = bumpVersion(String(pkg.version).split('-')[0], bumps.get(pkg.name));
  const floor = registryFloor(pkg.name);
  if (floor && cmpCore(floor, base) > 0) {
    console.log(`${pkg.name}: base ${base} is behind the registry; using ${floor}`);
    base = floor;
  }
  pkg.version = `${base}-${suffix}`;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}@${pkg.version}`);
}
