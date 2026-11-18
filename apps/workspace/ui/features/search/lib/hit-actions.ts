import { Eye, FolderOpen, History, Link2, MessageSquareWarning, Sparkles } from 'lucide-react'

import type { ActionMenuEntry } from '@/components/ui/action-menu'
import type { DocumentHit } from '@/lib/search/search-wire'

export type DocumentHitAction = 'open' | 'ask' | 'openCurrent' | 'openPoints' | 'showInFolder' | 'copyLink'

export type DocumentHitActionLabels = Record<DocumentHitAction, string>

export interface DocumentHitActionHandlers {
  onOpen: () => void
  onAsk: () => void
  onOpenCurrent: () => void
  onOpenPoints: () => void
  onShowInFolder: () => void
  onCopyLink: () => void
}

const GROUPS: readonly (readonly DocumentHitAction[])[] = [['open', 'ask'], ['openCurrent', 'openPoints', 'showInFolder'], ['copyLink']]

export function documentHitActions(hit: Pick<DocumentHit, 'shelf' | 'projectId' | 'superseded'>): DocumentHitAction[] {
  const offers = (action: DocumentHitAction): boolean => {
    if (action === 'ask') return hit.shelf === 'project' && Boolean(hit.projectId)
    if (action === 'openCurrent') return hit.superseded
    return true
  }
  return GROUPS.flat().filter(offers)
}

const ICONS = {
  open: Eye,
  ask: Sparkles,
  openCurrent: History,
  openPoints: MessageSquareWarning,
  showInFolder: FolderOpen,
  copyLink: Link2,
} as const

export function documentHitActionEntries(
  hit: Pick<DocumentHit, 'id' | 'shelf' | 'projectId' | 'superseded'>,
  labels: DocumentHitActionLabels,
  handlers: DocumentHitActionHandlers
): ActionMenuEntry[] {
  const run: Record<DocumentHitAction, () => void> = {
    open: handlers.onOpen,
    ask: handlers.onAsk,
    openCurrent: handlers.onOpenCurrent,
    openPoints: handlers.onOpenPoints,
    showInFolder: handlers.onShowInFolder,
    copyLink: handlers.onCopyLink,
  }
  const offered = new Set(documentHitActions(hit))
  const entries: ActionMenuEntry[] = []
  for (const group of GROUPS) {
    const items = group.filter((action) => offered.has(action))
    if (items.length === 0) continue
    if (entries.length > 0) entries.push({ type: 'separator' })
    for (const action of items) {
      entries.push({ type: 'item', id: action, label: labels[action], icon: ICONS[action], onSelect: run[action], testId: `search-hit-action-${action}` })
    }
  }
  return entries
}
