/**
 * A deliberately tiny markdown subset, rendered to DOM nodes — **never** through `innerHTML`.
 *
 * Model output is untrusted: it can carry text a prompt injection put there. So the only things it
 * can become are text nodes, `<p>`, `<br>`, `<strong>`, `<code>`, `<pre>` and `<a>` — and a link
 * only when its target parses as an `https:` URL (no `javascript:`, `data:`, `http:` or relative
 * paths), opened in a new tab with `rel="noopener noreferrer"`. Images are not rendered at all: a
 * markdown image is the classic zero-click exfiltration channel. Anything else stays literal text,
 * so `<img onerror=…>` in an answer is shown, not run.
 *
 * Supported: blank-line paragraphs, single newlines as line breaks, fenced code blocks (```),
 * `**bold**`, `` `code` ``, `[label](https://…)`.
 */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

export function renderMarkdown(text: string, doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const fences = text.split(/^```[^\n]*\n?/m);
  fences.forEach((chunk, i) => {
    if (i % 2 === 1) {
      // Inside a fence (an unterminated fence while streaming still renders as code).
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = chunk.replace(/\n$/, '');
      pre.appendChild(code);
      fragment.appendChild(pre);
      return;
    }
    for (const block of chunk.split(/\n{2,}/)) {
      if (!block.trim()) continue;
      const p = doc.createElement('p');
      block
        .replace(/^\n+|\n+$/g, '')
        .split('\n')
        .forEach((line, n) => {
          if (n > 0) p.appendChild(doc.createElement('br'));
          appendInline(p, line, doc);
        });
      fragment.appendChild(p);
    }
  });
  return fragment;
}

function appendInline(parent: Node, line: string, doc: Document): void {
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parent.appendChild(doc.createTextNode(line.slice(last, index)));
    const [token] = match;
    if (match[1]) {
      const code = doc.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (match[2]) {
      const strong = doc.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href) {
        const a = doc.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = label;
        parent.appendChild(a);
      } else {
        parent.appendChild(doc.createTextNode(token));
      }
    }
    last = index + token.length;
  }
  if (last < line.length) parent.appendChild(doc.createTextNode(line.slice(last)));
}

/** The URL, normalised, when it is absolute `https:`; otherwise `null`. */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
