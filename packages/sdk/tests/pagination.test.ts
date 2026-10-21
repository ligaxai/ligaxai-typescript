import { describe, expect, it } from 'vitest';

import { LigaX } from '../src/index.js';
import { Page } from '../src/core/pagination.js';
import { json, scriptedFetch } from './helpers.js';

describe('Page', () => {
  it('walks next_page cursors on for-await and exposes hasNextPage/getNextPage', async () => {
    const fetch = scriptedFetch([
      json({ data: [{ id: 'a' }, { id: 'b' }], next_page: 'cur_2' }),
      json({ data: [{ id: 'c' }], next_page: 'cur_3' }),
      json({ data: [{ id: 'd' }], next_page: null }),
    ]);
    const client = new LigaX({ apiKey: 'k', baseURL: 'https://api.example', fetch });
    const page = await client.getPage<{ id: string }>('/runs', { query: { limit: 2 } });
    expect(page).toBeInstanceOf(Page);
    expect(page.data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.hasNextPage()).toBe(true);

    const ids: string[] = [];
    for await (const run of page) ids.push(run.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);

    expect(fetch.calls.map((c) => c.url)).toEqual([
      'https://api.example/runs?limit=2',
      'https://api.example/runs?limit=2&page=cur_2',
      'https://api.example/runs?limit=2&page=cur_3',
    ]);
  });

  it('getNextPage throws when there is no next page', async () => {
    const page = new Page<{ id: string }>({ data: [], next_page: null }, async () => {
      throw new Error('unreachable');
    });
    expect(page.hasNextPage()).toBe(false);
    await expect(page.getNextPage()).rejects.toThrow('No next page');
  });
});
