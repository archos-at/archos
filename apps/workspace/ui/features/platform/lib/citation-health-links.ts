import type { MissingSourceAction } from './citation-health-types'

export const ACTION_ANCHOR: Partial<Record<MissingSourceAction, string>> = {
  upload_to_base_knowledge: '/app/platform/countries',
  add_to_norm_catalog: '/app/platform/countries',
}

export const timingHref = (conversationId: string, scopeQuery: string): string =>
  `/app/platform/quality?view=timing&${scopeQuery}&conversation=${encodeURIComponent(conversationId)}`
