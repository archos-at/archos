export const normalizeUrl = (url: string): string => url.trim().toLowerCase().replace(/\/+$/, '')

export const isHttpUrl = (url: string | undefined | null): boolean =>
  !!url && /^https?:\/\//i.test(url)

export const hostnameOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return null
  }
}
