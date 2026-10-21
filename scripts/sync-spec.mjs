#!/usr/bin/env node
/**
 * Download the public API spec and conformance fixtures for the tag in SPEC_VERSION.
 *
 *   pnpm sync-spec                  # uses SPEC_VERSION, org __GITHUB_ORG__, repo <slug>-spec
 *   pnpm sync-spec --tag spec-v0.3.0 --repo other-org/other-spec --dry-run
 *
 * Release assets expected on the GitHub release `<tag>`:
 *   openapi.json           -> openapi/openapi.json
 *   conformance.tar.gz     -> conformance/   (cases/, sse/, webhooks/)
 *
 * Environment: GITHUB_TOKEN is sent when set (private repos / rate limits). Never required for
 * a public spec. Nothing here runs in tests; `--dry-run` prints the URLs and exits.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = parseArgs(process.argv.slice(2));

const tag = args.tag ?? readFileSync(resolve(ROOT, 'SPEC_VERSION'), 'utf8').trim();
const repo = args.repo ?? '__GITHUB_ORG__/base-project-slug'.replace(/-typescript$/, '') + '-spec';
const apiBase = args['api-base'] ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';

if (!tag || tag === 'unset') {
  console.log('sync-spec: SPEC_VERSION is unset; set it to a spec tag (e.g. spec-v0.1.0) first.');
  process.exit(args['dry-run'] ? 0 : 1);
}

const releaseUrl = `${apiBase}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
console.log(`sync-spec: ${repo} @ ${tag}`);
if (args['dry-run']) {
  console.log(`  would GET ${releaseUrl}`);
  process.exit(0);
}

const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'base-project-slug/sync-spec',
};
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const release = await getJson(releaseUrl);
const asset = (name) => {
  const found = release.assets?.find((a) => a.name === name);
  if (!found) throw new Error(`release ${tag} has no asset named ${name}`);
  return found;
};

// openapi.json
const openapi = await getBytes(asset('openapi.json').url);
mkdirSync(resolve(ROOT, 'openapi'), { recursive: true });
writeFileSync(resolve(ROOT, 'openapi/openapi.json'), openapi);
console.log('  wrote openapi/openapi.json');

// conformance fixtures: replace the directory wholesale so removed cases disappear too.
const tarball = await getBytes(asset('conformance.tar.gz').url);
const tmp = resolve(ROOT, '.spec-tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
writeFileSync(resolve(tmp, 'conformance.tar.gz'), tarball);
execFileSync('tar', ['-xzf', 'conformance.tar.gz'], { cwd: tmp });
const extracted = resolve(tmp, 'conformance');
if (!existsSync(extracted))
  throw new Error('conformance.tar.gz must contain a top-level conformance/ dir');
for (const sub of ['cases', 'sse', 'webhooks']) {
  rmSync(resolve(ROOT, 'conformance', sub), { recursive: true, force: true });
}
execFileSync('cp', ['-R', `${extracted}/.`, resolve(ROOT, 'conformance')]);
rmSync(tmp, { recursive: true, force: true });
console.log('  refreshed conformance/{cases,sse,webhooks}');
console.log('\nNext: pnpm gen:types && pnpm test');

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function getBytes(url) {
  const res = await fetch(url, { headers: { ...headers, accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}
