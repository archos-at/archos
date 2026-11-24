import type { buildGraph } from './build-graph'
import type { ReasoningFlowProps } from './reasoning-flow-props'
import type { CitedDocument } from '../../../lib/citations'
import type { FanCard } from '../../../lib/retrieval-rounds'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { storedStep } from '@/test-utils/wire-v2-steps'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { Translator } from '@/i18n'

export const en = { chat: chatCopy.messages.en }
export const de = { chat: chatCopy.messages.de }

export const t = ((key: string) => key) as unknown as Translator

export const card = (id: string): CitedDocument => ({
  id,
  title: id,
  fileName: `${id}.pdf`,
  kind: 'building_law',
  tint: 'law',
  loci: [{ key: 'whole', isCited: true }],
})

export const base: ReasoningFlowProps = { steps: [], userQuestion: 'Frage?' }

export const retrievalStep = (
  index: number,
  query: string,
  reason?: string,
  tools: string[] = ['knowledge_search']
): StoredThinkingStep =>
  storedStep({
    id: `status:retrieval:${index}`,
    kind: 'retrieval',
    round: index,
    key: 'status.retrieval.withQuery',
    values: { corpus: 'knowledge', query },
    tools,
    ...(reason ? { reason } : {}),
  })

export const toolHit = (id: string, file: string, round?: number): StoredThinkingStep =>
  storedStep({
    id: `sources:${id}`,
    kind: 'sources',
    tool: 'knowledge_search',
    lanes: [
      {
        key: 'building_law_oib',
        label: 'OIB-Richtlinie',
        kind: 'building_law',
        hit_count: 1,
        sources: [{ name: `${file}.pdf`, ...(round !== undefined ? { round } : {}) }],
      },
    ],
  })

export const technicalStep = (slot: string, detail: Record<string, unknown>): StoredThinkingStep =>
  storedStep({ id: `status:${slot}`, kind: 'status', slot, channel: 'technical', detail })

export const DESKTOP_W = 680
export const PHONE_W = 340

export const framingHandles = (g: ReturnType<typeof buildGraph>): string[] =>
  ((g.nodes.find((n) => n.id === 'framing')!.data as { sources: Array<{ id: string }> }).sources).map((h) => h.id)

export const targetHandles = (g: ReturnType<typeof buildGraph>, id: string): string[] =>
  ((g.nodes.find((n) => n.id === id)!.data as { targets: Array<{ id: string }> }).targets).map((h) => h.id)

const isColumnId = (id: string) => /(^|-)col-\d+$/.test(id)
export const columnToColumnEdges = (g: ReturnType<typeof buildGraph>) =>
  g.edges.filter((e) => isColumnId(e.source) && isColumnId(e.target))

type Slot = { type: 'card'; fan: FanCard } | { type: 'fold'; folded: FanCard[] }
const slotsOf = (node: { data: unknown }): FanCard[] =>
  (node.data as { cards: Slot[] }).cards.flatMap((slot) => (slot.type === 'card' ? [slot.fan] : slot.folded))

export const columnCards = (g: ReturnType<typeof buildGraph>): string[][] =>
  g.nodes.filter((n) => n.type === 'sourceColumn').map((n) => slotsOf(n).map((s) => s.card?.id ?? s.name))

export const fanSlots = (g: ReturnType<typeof buildGraph>, i: number): FanCard[] =>
  g.nodes.filter((n) => n.id.startsWith(`r${i}-col-`)).flatMap(slotsOf)
