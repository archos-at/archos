export const DOCUMENT_IMAGE_PATHNAME_PATTERN = '/api/documents/*/image'

const DOCUMENT_IMAGE_PATHNAME = /^\/api\/documents\/[^/]+\/image$/

export const LOCAL_IMAGE_PATTERNS = [
  { pathname: '**', search: '' },
  { pathname: DOCUMENT_IMAGE_PATHNAME_PATTERN },
] as const

export function isOptimizerEligible(src: string | null | undefined): boolean {
  if (!src || !src.startsWith('/') || src.startsWith('//')) return false

  const queryAt = src.indexOf('?')
  if (queryAt === -1) return true

  return DOCUMENT_IMAGE_PATHNAME.test(src.slice(0, queryAt))
}
