import { baseKnowledgeEntryOf, baseKnowledgeHref } from '@/lib/base-knowledge/entry-link'
import type { InboxItemView } from '@/lib/inbox/types'

export const NORM_NOTICE_TYPES = [
  'base_knowledge.new_edition',
  'office_shelf.norm_suggested',
] as const satisfies readonly InboxItemView['type'][]

export type NormNoticeLinkId = 'uploadEdition' | 'viewEdition'

export interface NormNoticeLink {
  id: NormNoticeLinkId
  href: string
  primary: boolean
}

export interface NormNotice {
  names: string | null
  links: NormNoticeLink[]
  decide: boolean
}

export function normNoticeOf(item: InboxItemView): NormNotice | null {
  if (!(NORM_NOTICE_TYPES as readonly string[]).includes(item.type)) return null
  const href = item.state === 'inert' || item.state === 'resolved' ? null : item.href
  switch (item.type) {
    case 'base_knowledge.new_edition': {
      const entryId = baseKnowledgeEntryOf(href)
      return {
        names: null,
        decide: false,
        links: href
          ? [
              { id: 'uploadEdition', href, primary: true },
              ...(entryId ? [{ id: 'viewEdition' as const, href: baseKnowledgeHref(entryId, 'file'), primary: false }] : []),
            ]
          : [],
      }
    }
    default:
      return { names: item.excerpt, decide: href !== null && item.actionable && item.anchorId !== null, links: [] }
  }
}
