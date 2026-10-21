#!/usr/bin/env node
/**
 * Rename the template into a real project.
 *
 *   node scripts/bootstrap.mjs <slug> <scope-without-@> <ClassPrefix> "<Title>" <org> <base-url> [ENV_PREFIX]
 *   node scripts/bootstrap.mjs ligaxai-typescript ligaxai LigaX "LigaX" ligaxai https://api.ligax.ai/v1
 *
 * ENV_PREFIX defaults to the class prefix upper-cased (`LigaX` -> `LIGAX_API_KEY`); pass it when
 * the prefix has inner capitals you want split (`MyCo` -> `MY_CO`).
 *
 * Replaces every token from docs/TEMPLATE-TOKENS.md across `git ls-files`, skipping the lockfile
 * (run `pnpm install` afterwards to refresh it). Idempotent: running it twice, or on a repo that
 * was already bootstrapped, changes nothing. No dependencies beyond Node.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// The script and the token reference must survive a run, or a second run has nothing to compare
// against and reports the already-replaced spellings as "tokens".
const SKIP = new Set(['pnpm-lock.yaml', 'scripts/bootstrap.mjs', 'docs/TEMPLATE-TOKENS.md']);
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf|zip|gz)$/i;

const [slug, scope, prefix, title, org, baseUrl, envPrefixArg] = process.argv.slice(2);
if (!slug || !scope || !prefix || !title || !org || !baseUrl) {
  console.error(
    'usage: node scripts/bootstrap.mjs <slug> <scope-without-@> <ClassPrefix> "<Title>" <org> <base-url> [ENV_PREFIX]',
  );
  process.exit(2);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`slug must be kebab-case: ${slug}`);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scope))
  fail(`scope must be an npm scope without "@": ${scope}`);
if (!/^[A-Z][A-Za-z0-9]*$/.test(prefix)) fail(`ClassPrefix must be PascalCase: ${prefix}`);
if (!/^https?:\/\//.test(baseUrl)) fail(`base-url must be an absolute URL: ${baseUrl}`);
const envPrefix = envPrefixArg ?? prefix.toUpperCase();
if (!/^[A-Z][A-Z0-9_]*$/.test(envPrefix)) fail(`ENV_PREFIX must be SCREAMING_SNAKE: ${envPrefix}`);

// Derived spellings. Order matters: longer / more specific tokens first so `@base-project-scope`
// is rewritten before the bare `base-project-slug` substring could match inside it.
const replacements = [
  ['@base-project-scope', `@${scope}`],
  ['base-project-slug', slug],
  ['BASE_PROJECT_', `${envPrefix}_`],
  ['BaseProject', prefix],
  ['__PROJECT_TITLE__', title],
  ['__GITHUB_ORG__', org],
  ['__DEFAULT_BASE_URL__', baseUrl],
];

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !SKIP.has(f) && !BINARY.test(f));

const touched = [];
const counts = Object.fromEntries(replacements.map(([from]) => [from, 0]));
for (const rel of files) {
  const path = resolve(ROOT, rel);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue; // deleted in the working tree but still tracked
  }
  let next = text;
  for (const [from, to] of replacements) {
    const n = next.split(from).length - 1;
    if (n > 0) {
      counts[from] += n;
      next = next.split(from).join(to);
    }
  }
  if (next !== text) {
    writeFileSync(path, next);
    touched.push(rel);
  }
}

console.log(`bootstrap: ${touched.length} file(s) changed`);
for (const [from, to] of replacements) {
  if (counts[from] > 0) console.log(`  ${from} -> ${to}  (${counts[from]})`);
}
if (touched.length === 0) {
  console.log('  nothing to do (already bootstrapped?)');
} else {
  console.log('\nNext steps:');
  console.log('  pnpm install            # refresh pnpm-lock.yaml for the renamed packages');
  console.log('  pnpm check              # typecheck, lint, test, build, publint');
  console.log('  git diff --stat         # review, then commit');
  console.log('  Optionally delete scripts/bootstrap.mjs and docs/TEMPLATE-TOKENS.md.');
}

function fail(message) {
  console.error(`bootstrap: ${message}`);
  process.exit(2);
}
