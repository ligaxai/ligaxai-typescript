/**
 * Cursor pagination. The API answers list calls with `{ data: T[], next_page: string | null }`;
 * `Page` exposes the current slice and, with `for await`, walks every page transparently.
 */

export interface PageResponse<T> {
  data: T[];
  next_page: string | null;
  [key: string]: unknown;
}

export type PageFetcher<T> = (cursor: string) => Promise<PageResponse<T>>;

export class Page<T> implements AsyncIterable<T> {
  readonly data: T[];
  readonly next_page: string | null;
  private readonly fetchNext: PageFetcher<T>;

  constructor(body: PageResponse<T>, fetchNext: PageFetcher<T>) {
    this.data = body.data ?? [];
    this.next_page = body.next_page ?? null;
    this.fetchNext = fetchNext;
  }

  hasNextPage(): boolean {
    return this.next_page !== null && this.data.length > 0;
  }

  async getNextPage(): Promise<Page<T>> {
    if (this.next_page === null) {
      throw new Error('No next page; check hasNextPage() before calling getNextPage()');
    }
    return new Page(await this.fetchNext(this.next_page), this.fetchNext);
  }

  /** Iterate page by page. */
  async *iterPages(): AsyncGenerator<Page<T>> {
    let page: Page<T> = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }

  /** Iterate item by item across every page. */
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for await (const page of this.iterPages()) {
      for (const item of page.data) yield item;
    }
  }
}
