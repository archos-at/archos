import { type RowLinking } from '../WorkList'
import { type LinkSelection, type WorkRound } from '../../../lib/work-list'
import { type BasisLine } from '../../../lib/derivation-basis'
import { type CardLink } from '../SourceCard'
import { type FanCard } from '../../../lib/retrieval-rounds'

export const EDGE_STROKE = 'color-mix(in oklch, var(--foreground) 18%, transparent)'

export type HandleSpec = { id: string; left: string }

export type FlowNodeType = 'framing' | 'round' | 'sourceColumn' | 'findings'

export interface FlowNode {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export const CENTRE_BOTTOM: HandleSpec = { id: 'c-bottom', left: '50%' }

export const CENTRE_TOP: HandleSpec = { id: 'c-top', left: '50%' }

export const CENTRE_OUT: HandleSpec = { id: 'out', left: '50%' }

export type FramingData = {
  label: string
  question: string
  escalation?: string
  sources: HandleSpec[]
}

export type SourceColumnData = {
  cards: ColumnSlot[]
  grouped: boolean
  groupLabel: string
  colW?: number
  inTop: number
  live: boolean
  onSelect: (selection: LinkSelection | null) => void
  onToggleFold: (key: string) => void
}

export type ColumnSlot =
  | { type: 'card'; fan: FanCard; callIds: string[]; link?: CardLink }
  | {
      type: 'fold'
      key: string
      count: number
      names: string[]
      folded: FanCard[]
      live: boolean
      expanded: boolean
      receded: boolean
    }

export type FindingsData = {
  label: string
  pending?: boolean
  pendingNote?: string
  basis: Array<{ label: string; lines: BasisLine[]; open?: boolean }>
  compact: boolean
  truncation?: { before: string; step?: string; after: string; mono: boolean }
  limits?: { label: string; lines: Array<{ text: string; warn: boolean }> }
  targets: HandleSpec[]
  source: HandleSpec
}

export type RoundData = {
  label: string
  sub: string
  text: string
  actions: string[]
  calls?: WorkRound
  compact: boolean
  linking: RowLinking
  targets: HandleSpec[]
  sources: HandleSpec[]
  foldable: boolean
  folded: boolean
  foldSummary: string
  toggleLabel: string
  onToggle: () => void
}
