const DRAFT_ROOTS = ['/drafts/', '/workspace/'] as const

export function draftLinkPath(href: string): string | null {
  const root = DRAFT_ROOTS.find((prefix) => href.startsWith(prefix))
  if (!root) return null
  const rest = href.slice(root.length).split(/[?#]/)[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (!decoded || decoded.split('/').some((segment) => segment === '..')) return null
  return `/drafts/${decoded}`
}

export function draftDownloadHref(conversationId: string, href: string): string | null {
  const path = draftLinkPath(href)
  if (!path) return null
  return `/api/conversations/${encodeURIComponent(conversationId)}/draft/download?path=${encodeURIComponent(path)}`
}
