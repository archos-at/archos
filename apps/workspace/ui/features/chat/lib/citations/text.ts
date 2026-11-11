/** The small pure text and URL helpers of the citation model. Split from `model.ts`, which re-exports them. */

/** URL reduced to a comparison form (scheme/host lowercased, trailing slash dropped). */
export const normalizeUrl = (url: string): string => url.trim().toLowerCase().replace(/\/+$/, '')

const ORIGIN_TOKEN_RE = /^\s*\[(KB|Web|RIS)\]\s*/i

/** Strip a leading `[KB]`/`[RIS]`/`[Web]` token from display text. */
export const stripOriginToken = (text: string): string => text.replace(ORIGIN_TOKEN_RE, '').trim()

export const isHttpUrl = (url: string | undefined | null): boolean =>
  !!url && /^https?:\/\//i.test(url)

export const hostnameOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return null
  }
}
