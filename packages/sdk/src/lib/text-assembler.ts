/**
 * Positional assembly of the engine's offset-addressed text.
 *
 * **Never concatenate deltas on arrival.** A `text.delta` payload is `{part_id, offset, text}` and
 * `offset` is a position in UTF-16 code units (a JS string index). A resumed stream legitimately
 * replays frames the client already saw; appending would duplicate the replayed span and the answer
 * would read as if the model stuttered — on a clean run appending happens to work, which is exactly
 * why it is the bug that ships. Writing each delta at its offset makes a replay a no-op.
 *
 * Two outputs, deliberately different:
 *
 * - `apply()` returns only text that is **new and contiguous** for that part, so a caller can print
 *   it as it arrives. A delta that lands beyond the current end (out of order) is held until the gap
 *   fills; a trailing high surrogate is held until its pair arrives, so an emoji is never split
 *   across two chunks.
 * - `text()` is the answer: every `text` part in `part.start` order, joined. A gap that never filled
 *   is padded with spaces — the platform's rule — so later text keeps the position the engine gave
 *   it rather than sliding left.
 *
 * `reasoning.*` parts are assembled too (so their offsets stay right) but never surface in either
 * output: they are not the answer.
 */

export interface TextAssemblerEvent {
  type: string;
  seq: number | null;
  payload: Record<string, unknown>;
}

interface Part {
  kind: string;
  /** Contiguous text from offset 0. */
  text: string;
  /** Deltas that landed beyond `text.length`, waiting for the gap to fill. */
  pending: Array<{ offset: number; text: string }>;
  /** How much of `text` has been handed out by `apply()`. */
  emitted: number;
  /** Sort key: the `part.start` seq when known, else when the part was first seen. */
  order: number;
  started: boolean;
  ended: boolean;
}

/** Order for a part seen without a seq: after every real seq, in first-seen order. */
const UNSEQUENCED = 2 ** 40;

export class TextAssembler {
  private readonly parts = new Map<string, Part>();
  private counter = 0;

  /**
   * Fold one event. Returns the newly appended answer text (empty for anything else), and is safe
   * to call with a replayed or out-of-order frame.
   */
  apply(event: TextAssemblerEvent): string {
    const payload = event.payload ?? {};
    const partId = typeof payload['part_id'] === 'string' ? payload['part_id'] : '';
    switch (event.type) {
      case 'part.start': {
        if (!partId) return '';
        const part = this.part(partId, event.seq, kindOf(payload['kind']));
        if (!part.started) {
          part.started = true;
          // `part.start` fixes the order even when a delta (on a resume) created the part first.
          if (typeof event.seq === 'number') part.order = event.seq;
          if (typeof payload['kind'] === 'string') part.kind = kindOf(payload['kind']);
        }
        return '';
      }
      case 'text.delta':
      case 'reasoning.delta': {
        if (!partId) return '';
        const kind = event.type === 'reasoning.delta' ? 'reasoning' : 'text';
        const part = this.part(partId, event.seq, kind);
        const offset = typeof payload['offset'] === 'number' ? payload['offset'] : 0;
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        write(part, offset, text);
        return part.kind === 'text' ? take(part) : '';
      }
      case 'part.end': {
        const part = this.parts.get(partId);
        if (!part) return '';
        part.ended = true;
        return part.kind === 'text' ? take(part) : '';
      }
      default:
        return '';
    }
  }

  /** Assembled text of one part (any kind), gaps padded. */
  partText(partId: string): string {
    const part = this.parts.get(partId);
    return part ? materialise(part) : '';
  }

  /** Whether the part is a text part (the answer) rather than reasoning. */
  isText(partId: string): boolean {
    return this.parts.get(partId)?.kind === 'text';
  }

  /** The answer: every text part in `part.start` order. */
  text(): string {
    return [...this.parts.values()]
      .filter((part) => part.kind === 'text')
      .sort((a, b) => a.order - b.order)
      .map(materialise)
      .join('');
  }

  private part(partId: string, seq: number | null, kind: string): Part {
    let part = this.parts.get(partId);
    if (!part) {
      part = {
        kind,
        text: '',
        pending: [],
        emitted: 0,
        order: typeof seq === 'number' ? seq : UNSEQUENCED + this.counter,
        started: false,
        ended: false,
      };
      this.counter += 1;
      this.parts.set(partId, part);
    }
    return part;
  }
}

function kindOf(value: unknown): string {
  return typeof value === 'string' && value ? value : 'text';
}

/** A positional write; then fold in any held deltas the write made contiguous. */
function write(part: Part, offset: number, text: string): void {
  if (offset > part.text.length) {
    part.pending.push({ offset, text });
    return;
  }
  part.text = part.text.slice(0, offset) + text + part.text.slice(offset + text.length);
  for (let progressed = true; progressed && part.pending.length > 0;) {
    progressed = false;
    for (let i = 0; i < part.pending.length; i++) {
      const held = part.pending[i]!;
      if (held.offset <= part.text.length) {
        part.pending.splice(i, 1);
        part.text =
          part.text.slice(0, held.offset) +
          held.text +
          part.text.slice(held.offset + held.text.length);
        progressed = true;
        break;
      }
    }
  }
}

/** Hand out what is new, holding back a lone high surrogate until the part ends. */
function take(part: Part): string {
  let end = part.text.length;
  if (!part.ended && end > part.emitted) {
    const last = part.text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  if (end <= part.emitted) return '';
  const out = part.text.slice(part.emitted, end);
  part.emitted = end;
  return out;
}

function materialise(part: Part): string {
  if (part.pending.length === 0) return part.text;
  let text = part.text;
  for (const held of [...part.pending].sort((a, b) => a.offset - b.offset)) {
    if (held.offset > text.length) text += ' '.repeat(held.offset - text.length);
    text = text.slice(0, held.offset) + held.text + text.slice(held.offset + held.text.length);
  }
  return text;
}
