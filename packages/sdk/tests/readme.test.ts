/**
 * The package READMEs are the npm pages and the user guide, and AI assistants copy from them — so
 * their code must stay true to the packages. These checks keep them from drifting:
 *
 * - every ```ts / ```tsx block is valid syntax;
 * - every `import { … } from '@ligaxai/…'` names something that entry point really exports;
 * - package READMEs use only absolute links (npm does not resolve relative links from a package
 *   folder, so a relative link is a dead link on the npm page).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(ROOT + path, 'utf8');

const PACKAGE_READMES = [
  'packages/sdk/README.md',
  'packages/react/README.md',
  'packages/widget/README.md',
];
const ALL_READMES = ['README.md', ...PACKAGE_READMES];

// Entry point → source file. The SDK's are imported for their runtime exports; the React and
// widget ones are read as text, because importing them needs React and a DOM.
const SDK_ENTRIES: Record<string, () => Promise<Record<string, unknown>>> = {
  '@ligaxai/sdk': () => import('../src/index.js'),
  '@ligaxai/sdk/next': () => import('../src/next.js'),
  '@ligaxai/sdk/ai-sdk': () => import('../src/ai-sdk.js'),
  '@ligaxai/sdk/webhooks': () => import('../src/webhooks.js'),
  '@ligaxai/sdk/errors': () => import('../src/errors.js'),
};
const TEXT_ENTRIES: Record<string, string> = {
  '@ligaxai/react': 'packages/react/src/index.ts',
  '@ligaxai/widget': 'packages/widget/src/index.ts',
  '@ligaxai/widget/react': 'packages/widget/src/react.ts',
};

function blocks(text: string): { lang: string; code: string }[] {
  return [...text.matchAll(/```(ts|tsx)\n([\s\S]*?)```/g)].map((m) => ({
    lang: m[1]!,
    code: m[2]!,
  }));
}

function imports(code: string): { names: string[]; from: string }[] {
  return [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@ligaxai\/[^']+)'/g)].map((m) => ({
    names: m[1]!
      .split(',')
      .map((n) => n.trim().replace(/^type\s+/, ''))
      .filter(Boolean),
    from: m[2]!,
  }));
}

function textExports(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)/g))
    names.add(m[1]!);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g))
    for (const n of m[1]!.split(',')) {
      const name = n
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  return names;
}

describe.each(ALL_READMES)('%s', (path) => {
  const text = read(path);

  it('has only syntactically valid TypeScript blocks', () => {
    for (const { lang, code } of blocks(text)) {
      const out = ts.transpileModule(code, {
        fileName: `snippet.${lang}`,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
      });
      const messages = (out.diagnostics ?? []).map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      );
      expect(messages, code).toEqual([]);
    }
  });

  it('imports only names the packages export', async () => {
    for (const { code } of blocks(text)) {
      for (const { names, from } of imports(code)) {
        const exported = SDK_ENTRIES[from]
          ? new Set(Object.keys(await SDK_ENTRIES[from]!()))
          : TEXT_ENTRIES[from]
            ? textExports(read(TEXT_ENTRIES[from]!))
            : undefined;
        expect(exported, `unknown entry point ${from}`).toBeDefined();
        for (const name of names) expect(exported!.has(name), `${from} exports ${name}`).toBe(true);
      }
    }
  });
});

describe.each(PACKAGE_READMES)('%s (npm page)', (path) => {
  it('uses only absolute links', () => {
    const targets = [...read(path).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
    expect(targets.filter((t) => !/^(https?:|mailto:)/.test(t))).toEqual([]);
  });

  it('documents the required base URL with a placeholder host', () => {
    const text = read(path);
    expect(text).toContain('https://<your-ligax-host>/api/public/v1');
  });
});
