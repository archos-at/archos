export const BASE_KNOWLEDGE_PATH = '/app/base-knowledge'

export type BaseKnowledgeView = 'entry' | 'file'

export function baseKnowledgeHref(entryId: string | null | undefined, view: BaseKnowledgeView = 'entry'): string {
  const id = entryId?.trim()
  return id ? `${BASE_KNOWLEDGE_PATH}?${view}=${encodeURIComponent(id)}` : BASE_KNOWLEDGE_PATH
}

export function baseKnowledgeEntryOf(href: string | null | undefined): string | null {
  if (!href) return null
  const url = new URL(href, 'https://archos.invalid')
  if (url.pathname !== BASE_KNOWLEDGE_PATH) return null
  return url.searchParams.get('entry') ?? url.searchParams.get('file')
}
