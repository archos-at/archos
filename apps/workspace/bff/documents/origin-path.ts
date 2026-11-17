const ORIGIN_PATH_MAX_CHARS = 1024

export function sanitizeOriginPath(raw: string | null | undefined): string | null {
  return normalizeOriginPath(raw)?.slice(0, ORIGIN_PATH_MAX_CHARS) || null
}

export function normalizeOriginPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const segments = raw
    .replace(/\\/g, '/')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
  return segments.length === 0 ? null : segments.join('/')
}
