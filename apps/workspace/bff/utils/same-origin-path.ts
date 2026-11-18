export function isSameOriginPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
}

export const MAX_RETURN_PATH_LENGTH = 1000

const isControl = (char: string): boolean => {
  const code = char.charCodeAt(0)
  return code < 0x20 || code === 0x7f
}

const PROBE_ORIGIN = 'https://return-path.invalid'

export function appReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_RETURN_PATH_LENGTH) return null
  if (!isSameOriginPath(value) || [...value].some(isControl)) return null
  let url: URL
  try {
    url = new URL(value, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN || !url.pathname.startsWith('/app/')) return null
  return `${url.pathname}${url.search}${url.hash}`
}
