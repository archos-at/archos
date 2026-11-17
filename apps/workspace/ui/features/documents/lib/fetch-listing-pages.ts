import { DOCUMENT_LEVEL_LIMIT_MAX } from '@/lib/documents/list-query'

export const MAX_LISTING_PAGES = 20

function withLargestPage(url: string): string {
  if (/[?&]limit=/.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}limit=${DOCUMENT_LEVEL_LIMIT_MAX}`
}

export interface ListingPage<Row> {
  documents?: Row[]
  nextCursor?: string | null
}

export class ListingFetchError extends Error {
  constructor(readonly status: number) {
    super(`Failed to load listing (${status})`)
    this.name = 'ListingFetchError'
  }
}

export interface DrainedListing<Row, Body extends ListingPage<Row>> {
  first: Body
  documents: Row[]
  truncated: boolean
}

export interface ListingPageArrival<Row, Body> {
  rows: Row[]
  body: Body
  index: number
}

export interface ListingReadOptions<Row, Body> {
  maxPages?: number
  fetcher?: typeof fetch
  from?: { cursor: string; pagesRead: number }
  onPage?: (page: ListingPageArrival<Row, Body>) => void
}

function withCursor(url: string, cursor: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
}

export async function fetchListingPages<Row, Body extends ListingPage<Row> = ListingPage<Row>>(
  url: string,
  { maxPages = MAX_LISTING_PAGES, fetcher = fetch, from, onPage }: ListingReadOptions<Row, Body> = {},
): Promise<DrainedListing<Row, Body>> {
  url = withLargestPage(url)
  let first: Body | null = null
  const documents: Row[] = []
  let cursor: string | null = from?.cursor ?? null
  for (let page = from?.pagesRead ?? 0; page < Math.max(1, maxPages); page++) {
    const response = await fetcher(cursor ? withCursor(url, cursor) : url)
    if (!response.ok) throw new ListingFetchError(response.status)
    const body = (await response.json()) as Body
    first ??= body
    const rows = body.documents ?? []
    documents.push(...rows)
    onPage?.({ rows, body, index: page })
    cursor = body.nextCursor ?? null
    if (!cursor) return { first, documents, truncated: false }
  }
  return { first: first ?? ({} as Body), documents, truncated: true }
}
