export const PAGE_PARAM = 'page'
export const HIGHLIGHT_PARAM = 'highlight'

export const HIGHLIGHT_LINK_CHARS = 200

export interface DocumentLocus {
  page: number | null
  highlight: string | null
}

const NO_LOCUS: DocumentLocus = { page: null, highlight: null }

export function parsePage(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const page = Number(value.trim())
  return Number.isSafeInteger(page) && page >= 1 ? page : null
}

export function clipHighlight(text: string | null | undefined, max = HIGHLIGHT_LINK_CHARS): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return null
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim()
}

export function readDocumentLocus(
  params: Pick<URLSearchParams, 'get'> | null | undefined,
  documentId: string
): DocumentLocus {
  if (!params || params.get('doc') !== documentId) return NO_LOCUS
  return { page: parsePage(params.get(PAGE_PARAM)), highlight: clipHighlight(params.get(HIGHLIGHT_PARAM)) }
}

export function setDocumentLocus(params: URLSearchParams, locus: Partial<DocumentLocus>): URLSearchParams {
  if (locus.page && locus.page >= 1) params.set(PAGE_PARAM, String(Math.trunc(locus.page)))
  else params.delete(PAGE_PARAM)
  const highlight = clipHighlight(locus.highlight)
  if (highlight) params.set(HIGHLIGHT_PARAM, highlight)
  else params.delete(HIGHLIGHT_PARAM)
  return params
}

export function clearDocumentLocus(params: URLSearchParams): URLSearchParams {
  params.delete(PAGE_PARAM)
  params.delete(HIGHLIGHT_PARAM)
  return params
}

export function withDocumentLocus(href: string, locus: Partial<DocumentLocus>): string {
  const [base, hash = ''] = href.split('#')
  const [pathname, search = ''] = base.split('?')
  const params = setDocumentLocus(new URLSearchParams(search), locus)
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`
}
