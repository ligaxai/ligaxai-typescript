import { describe, expect, it } from 'vitest';

import { TextAssembler } from '../src/lib/text-assembler.js';

const start = (seq: number, part_id: string, kind = 'text') => ({
  type: 'part.start',
  seq,
  payload: { part_id, kind },
});
const delta = (seq: number, part_id: string, offset: number, text: string) => ({
  type: 'text.delta',
  seq,
  payload: { part_id, offset, text },
});
const end = (seq: number, part_id: string) => ({ type: 'part.end', seq, payload: { part_id } });

describe('TextAssembler', () => {
  it('yields only newly appended text and treats a replayed delta as a no-op', () => {
    const a = new TextAssembler();
    a.apply(start(1, 'p'));
    expect(a.apply(delta(2, 'p', 0, 'Hello'))).toBe('Hello');
    expect(a.apply(delta(3, 'p', 5, ', world'))).toBe(', world');
    // Resume replays both frames: nothing new, nothing duplicated.
    expect(a.apply(delta(2, 'p', 0, 'Hello'))).toBe('');
    expect(a.apply(delta(3, 'p', 5, ', world'))).toBe('');
    expect(a.text()).toBe('Hello, world');
  });

  it('holds an out-of-order delta until the gap fills, then yields the contiguous run', () => {
    const a = new TextAssembler();
    a.apply(start(1, 'p'));
    expect(a.apply(delta(3, 'p', 3, 'def'))).toBe('');
    expect(a.apply(delta(4, 'p', 6, 'ghi'))).toBe('');
    expect(a.apply(delta(2, 'p', 0, 'abc'))).toBe('abcdefghi');
    expect(a.text()).toBe('abcdefghi');
  });

  it('pads a gap that never filled so later text keeps its offset', () => {
    const a = new TextAssembler();
    a.apply(delta(2, 'p', 0, 'ab'));
    a.apply(delta(4, 'p', 4, 'ef'));
    expect(a.text()).toBe('ab  ef');
  });

  it('joins text parts in part.start order and ignores reasoning', () => {
    const a = new TextAssembler();
    a.apply(start(1, 'first'));
    a.apply(start(2, 'thought', 'reasoning'));
    a.apply(start(3, 'second'));
    // Deltas interleave and the later part writes first.
    a.apply(delta(4, 'second', 0, ' Second.'));
    expect(
      a.apply({
        type: 'reasoning.delta',
        seq: 5,
        payload: { part_id: 'thought', offset: 0, text: 'hmm' },
      }),
    ).toBe('');
    a.apply(delta(6, 'first', 0, 'First.'));
    a.apply(end(7, 'first'));
    a.apply(end(8, 'second'));
    expect(a.text()).toBe('First. Second.');
    expect(a.partText('thought')).toBe('hmm');
    expect(a.isText('thought')).toBe(false);
  });

  it('lets part.start fix the order even when a resumed delta created the part first', () => {
    const a = new TextAssembler();
    a.apply(delta(10, 'late', 0, 'B'));
    a.apply(start(1, 'early'));
    a.apply(delta(2, 'early', 0, 'A'));
    a.apply(start(9, 'late'));
    expect(a.text()).toBe('AB');
  });

  it('addresses offsets in UTF-16 code units, so an emoji counts as two', () => {
    const a = new TextAssembler();
    a.apply(start(1, 'p'));
    expect(a.apply(delta(2, 'p', 0, 'Hi 👋'))).toBe('Hi 👋');
    // "Hi 👋".length === 5 in UTF-16; the next delta lands right after the emoji.
    expect(a.apply(delta(3, 'p', 5, ' there'))).toBe(' there');
    expect(a.text()).toBe('Hi 👋 there');
  });

  it('never splits a surrogate pair across two yielded chunks', () => {
    const a = new TextAssembler();
    a.apply(start(1, 'p'));
    const wave = '👋';
    expect(a.apply(delta(2, 'p', 0, `ok ${wave[0]}`))).toBe('ok ');
    expect(a.apply(delta(3, 'p', 4, `${wave[1]}!`))).toBe(`${wave}!`);
    expect(a.text()).toBe('ok 👋!');
  });

  it('ignores events it does not know and deltas without a part id', () => {
    const a = new TextAssembler();
    expect(a.apply({ type: 'tool.start', seq: 1, payload: {} })).toBe('');
    expect(a.apply({ type: 'text.delta', seq: 2, payload: { offset: 0, text: 'x' } })).toBe('');
    expect(a.text()).toBe('');
  });
});
