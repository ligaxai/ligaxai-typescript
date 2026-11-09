/**
 * No LigaX deployment host ships in this repository (docs/DECISIONS.md, 2026-11-09).
 *
 * The packages are published to npm, so a hard-coded production or development API root would be
 * advertised by every installed copy, and a silent fallback to one would send a key somewhere the
 * caller never chose. The caller always names the platform (`baseURL` or LIGAX_BASE_URL); docs use
 * the placeholder `https://<your-ligax-host>`. This fails if a real host creeps back in — through a
 * spec sync, an example, or a doc edit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// A host under one of the company's domains, or a Cloud Run URL. The look-behind lets an e-mail
// address (`security@…`) through: that is a contact, not an API root.
const HOST =
  /(?<![@\w.-])(?:[a-z0-9-]+\.)*(?:ligax|ligaments)\.ai\b|[a-z0-9-]+\.[a-z0-9-]+\.run\.app\b/gi;

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.spec-tmp',
]);
const SUFFIXES = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.js',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.example',
]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (SUFFIXES.has(extname(name)) || name.endsWith('.env.example')) out.push(path);
  }
  return out;
}

describe('no deployment host', () => {
  const all = files(ROOT);
  const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

  it('scans the packages, spec and docs', () => {
    const names = new Set(all.map(rel));
    expect(names.has('packages/sdk/src/client.ts')).toBe(true);
    expect(names.has('packages/widget/README.md')).toBe(true);
    expect(names.has('openapi/openapi.json')).toBe(true);
  });

  it('finds no LigaX deployment or Cloud Run host anywhere in the repository', () => {
    const hits: string[] = [];
    for (const path of all) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const match of line.matchAll(HOST)) hits.push(`${rel(path)}:${i + 1}: ${match[0]}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('catches hosts and spares contact addresses', () => {
    // Built from parts so this file does not trip its own scan.
    const sample = (s: string) => new RegExp(HOST.source, 'i').test(s);
    expect(sample('https://api.example-tenant.ligax' + '.ai/api/public/v1')).toBe(true);
    expect(sample('svc-abc123.us-central1.run' + '.app')).toBe(true);
    expect(sample('Email security@ligaments.ai')).toBe(false);
    expect(sample("import { LigaX } from '@ligaxai/sdk'")).toBe(false);
  });
});
