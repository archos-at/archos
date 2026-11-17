import type { ReasoningFlowProps } from './reasoning-flow-props'
import { type Node, type Edge } from '@xyflow/react'
import type { Translator } from '@/i18n'
import { type RowLinking } from '../WorkList'
import { quoteQuery } from '../../../lib/work-sentence'
import {
  callIdsByDocument,
  isLinked,
  prefetchRounds,
  withActionRounds,
  workKind,
  workRounds,
} from '../../../lib/work-list'
import { basisLines, cardForTarget, cardName, openPoints } from '../../../lib/derivation-basis'
import { isCited, normalizeFileName, type CitedDocument } from '../../../lib/citations'
import { documentShortName } from '../../../lib/document-names'
import { FOLDER_TAB_H, type CardLink } from '../SourceCard'
import {
  answerDegradations,
  deepResearchCutoff,
  researchTruncation,
} from '../../../lib/turn-events'
import { stepNameLabel } from '../../../lib/executed-steps'
import {
  retrievalRounds,
  roundFan,
  type FanCard,
  type RetrievalRound,
} from '../../../lib/retrieval-rounds'
import {
  HandleSpec,
  CENTRE_BOTTOM,
  CENTRE_TOP,
  CENTRE_OUT,
  FramingData,
  SourceColumnData,
  ColumnSlot,
  FindingsData,
  RoundData,
} from './flow-node-data'
import { GROUPED_MAX_W, FanLayout, packSlots } from './flow-layout'
import { edge } from './flow-edges'
import { LIMIT, limitations, foldSummary } from './flow-labels'
import { roundKind, SpineFolding, GraphInteraction, NO_INTERACTION } from './round-kind'

export interface BuiltGraph {
  nodes: Node[]
  edges: Edge[]
  rows: string[][]
}

const LIVE_FAN_MAX = 3

const LIVE_SHOWN = 2

export function partitionFan(
  slots: readonly FanCard[],
  live: boolean
): { shown: FanCard[]; folded: FanCard[] } {
  if (live) {
    if (slots.length <= LIVE_FAN_MAX) return { shown: [...slots], folded: [] }
    return { shown: slots.slice(0, LIVE_SHOWN), folded: slots.slice(LIVE_SHOWN) }
  }
  const cited = (slot: FanCard) => Boolean(slot.card && isCited(slot.card))
  return { shown: slots.filter(cited), folded: slots.filter((slot) => !cited(slot)) }
}

const mergeFans = (first: readonly FanCard[], second: readonly FanCard[]): FanCard[] => {
  const seen = new Set<string>()
  const out: FanCard[] = []
  for (const slot of [...first, ...second]) {
    const key = normalizeFileName(slot.card?.fileName ?? slot.name) || slot.key
    if (seen.has(key)) continue
    seen.add(key)
    out.push(slot)
  }
  return out
}

export function buildGraph(
  props: ReasoningFlowProps,
  t: Translator,
  layout: FanLayout,
  cards: CitedDocument[],
  folding: SpineFolding = { folded: new Set<number>(), onToggle: () => {} },
  rounds: RetrievalRound[] = withActionRounds(retrievalRounds(props.steps), props.steps),
  interaction: GraphInteraction = NO_INTERACTION
): BuiltGraph {
  const work = workRounds(props.steps)
  const live = Boolean(props.live)
  const compact = layout.contentW <= GROUPED_MAX_W
  const { selection } = interaction
  const prefetch = prefetchRounds(props.steps)
  const visible = rounds.filter((round) => !prefetch.has(round.index))
  const prefetched = rounds.filter((round) => prefetch.has(round.index))

  const callsOf = callIdsByDocument(props.steps, normalizeFileName)
  const slotCalls = (slot: FanCard): string[] => {
    const names = [slot.name, slot.card?.fileName, slot.card?.title].filter(
      (name): name is string => Boolean(name)
    )
    return [...new Set(names.flatMap((name) => callsOf.get(normalizeFileName(name)) ?? []))]
  }
  const linkOf = (key: string, callIds: string[]): CardLink | undefined => {
    if (!selection) return undefined
    if (selection.key === key) return 'selected'
    return isLinked(selection, callIds) ? 'linked' : 'receded'
  }

  const columnSlots = (fanKey: string, slots: readonly FanCard[]): ColumnSlot[] => {
    const { shown, folded } = partitionFan(slots, live)
    const open = interaction.openFolds.has(fanKey)
    const standing = open ? [...shown, ...folded] : shown
    const out: ColumnSlot[] = standing.map((fan) => {
      const callIds = slotCalls(fan)
      const link = linkOf(fan.key, callIds)
      return { type: 'card', fan, callIds, ...(link ? { link } : {}) }
    })
    if (folded.length > 0) {
      out.push({
        type: 'fold',
        key: fanKey,
        count: folded.length,
        names: folded.map((fan) =>
          documentShortName(fan.card?.fileName ?? fan.name, fan.card?.title ?? fan.title)
        ),
        folded,
        live,
        expanded: open,
        receded: selection !== null && !folded.some((fan) => isLinked(selection, slotCalls(fan))),
      })
    }
    return out
  }

  const spine = visible.length >= 2 || (visible.length === 1 && work.length > 0)
  const pendingFindings = live && (cards.length > 0 || spine)
  const truncation = live ? null : researchTruncation(props.steps)
  const cutoff = live ? null : deepResearchCutoff(props.steps)
  const degradations = live ? [] : answerDegradations(props.steps)
  const limitLines = limitations(cutoff, degradations, t)
  const basis = live ? null : basisLines(t, cards)
  const open = live ? [] : openPoints(t, work, cards)
  const B = 'thinking.node.basis.'
  const basisGroups: FindingsData['basis'] = basis
    ? [
        ...(basis.law.length > 0 ? [{ label: t(`${B}law`), lines: basis.law }] : []),
        ...(basis.evidence.length > 0 ? [{ label: t(`${B}evidence`), lines: basis.evidence }] : []),
        ...(open.length > 0
          ? [
              {
                label: t(`${B}open`),
                lines: open.map((text) => ({ numbers: [], text })),
                open: true,
              },
            ]
          : []),
      ]
    : []
  const hasFindings =
    pendingFindings || basisGroups.length > 0 || Boolean(truncation) || limitLines.length > 0

  const convergeId = hasFindings ? 'findings' : null

  const framingSources: HandleSpec[] = [CENTRE_BOTTOM]
  const convergeTargets: HandleSpec[] = [CENTRE_TOP]

  const framingData: FramingData = {
    label: t('thinking.node.framingTab'),
    question: props.userQuestion.trim()
      ? t('thinking.node.framingQuestion', { question: quoteQuery(t, props.userQuestion) })
      : t('thinking.node.framingTitle'),
    escalation: props.escalationReason?.trim()
      ? t('thinking.escalationNarration', { reason: props.escalationReason.trim() })
      : undefined,
    sources: framingSources,
  }
  const truncationLine = (() => {
    if (!truncation) return undefined
    if (!truncation.lastTool) {
      return { before: t('thinking.node.findingsTruncated'), after: '', mono: false }
    }
    const named = stepNameLabel(truncation.lastTool, t)
    const template = t('thinking.node.findingsTruncatedStep')
    const [before = '', after = ''] = template.split('{tool}')
    return { before, step: named ?? truncation.lastTool, after, mono: named === null }
  })()
  const findingsData: FindingsData | null = hasFindings
    ? {
        label: pendingFindings ? t(`${B}pendingLabel`) : t(`${B}label`),
        pending: pendingFindings,
        ...(pendingFindings ? { pendingNote: t(`${B}pending`) } : {}),
        basis: basisGroups,
        compact,
        truncation: truncationLine,
        limits:
          limitLines.length > 0 ? { label: t(`${LIMIT}label`), lines: limitLines } : undefined,
        targets: convergeTargets,
        source: CENTRE_OUT,
      }
    : null
  const nodes: Node[] = []
  const edges: Edge[] = []

  const roundIds = spine ? visible.map((_, i) => `round-${i}`) : []

  const actionLabels = (tools: string[]): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const tool of tools) {
      const label = stepNameLabel(tool, t)
      if (!label || seen.has(label)) continue
      seen.add(label)
      out.push(label)
    }
    return out
  }

  const prefetchSlots = prefetched.flatMap((round) => roundFan(round, cards, props.retrievalLedger))

  const fans = spine
    ? visible.map((round, i) => {
        const own = roundFan(round, cards, props.retrievalLedger)
        const roundCards = i === 0 ? mergeFans(prefetchSlots, own) : own
        const slots = columnSlots(`round-${round.index}`, roundCards)
        const packed = packSlots(layout.contentW, slots)
        const folded = folding.folded.has(i)
        return {
          roundCards,
          slots,
          packed,
          folded,
          ids: folded ? [] : packed.columns.map((_, c) => `r${i}-col-${c}`),
        }
      })
    : []

  const pushColumns = (ids: string[], packed: FanLayout, slots: ColumnSlot[]) => {
    if (ids.length === 0) return
    const xOf = (i: number) => packed.fanX + i * (packed.colW + packed.gap)
    packed.columns.slice(0, ids.length).forEach((indices, i) => {
      const cards = indices.map((idx) => slots[idx]!)
      const first = cards[0]
      const tabbed = first?.type === 'fold' ? !first.expanded : Boolean(first?.fan.card)
      const columnData: SourceColumnData = {
        cards,
        inTop: tabbed && !packed.grouped ? FOLDER_TAB_H : 0,
        grouped: packed.grouped,
        groupLabel: t('thinking.sourcesFanOut'),
        live,
        colW: packed.colW,
        onSelect: interaction.onSelect,
        onToggleFold: interaction.onToggleFold,
      }
      nodes.push({
        id: ids[i]!,
        type: 'sourceColumn',
        position: { x: xOf(i), y: 0 },
        data: columnData as unknown as Record<string, unknown>,
      })
    })
  }

  const linking: RowLinking = {
    selection,
    onSelect: interaction.onSelect,
    carded: new Set([...callsOf.values()].flat()),
    nameOf: (target) => {
      const card = cardForTarget(target, cards)
      return card ? cardName(card) : undefined
    },
  }
  nodes.push({
    id: 'framing',
    type: 'framing',
    position: { x: 0, y: 0 },
    data: framingData as Record<string, unknown>,
  })
  const turnFan = spine
    ? null
    : (() => {
        const slots = columnSlots(
          'turn',
          cards.map((card) => ({ key: card.id, card, name: card.fileName ?? card.title }))
        )
        return { slots, packed: packSlots(layout.contentW, slots) }
      })()
  const columnIds = turnFan ? turnFan.packed.columns.map((_, i) => `col-${i}`) : []
  if (spine) {
    visible.forEach((round, i) => {
      const text = round.reason?.trim() ?? ''
      const fan = fans[i]!
      const documentCount = fan.roundCards.length
      const accounted = props.retrievalLedger?.some((entry) => entry.index === round.index) ?? false
      const calls = work.find((entry) => entry.round === round.index)
      const roundData: RoundData = {
        label: t('thinking.node.stepTab', { n: i + 1 }),
        sub: calls
          ? t(`thinking.work.kind.${workKind(calls)}`)
          : roundKind(text.length > 0, documentCount, round.tools, t, accounted),
        text,
        actions: actionLabels(round.tools),
        ...(calls ? { calls } : {}),
        compact,
        linking,
        targets: [CENTRE_TOP],
        sources: [CENTRE_BOTTOM],
        foldable: !calls && documentCount > 0,
        folded: fan.folded,
        foldSummary: foldSummary(fan.roundCards, t),
        toggleLabel: t(fan.folded ? 'thinking.node.roundUnfold' : 'thinking.node.roundFold', {
          n: i + 1,
        }),
        onToggle: () => folding.onToggle(i),
      }
      nodes.push({
        id: roundIds[i]!,
        type: 'round',
        position: { x: 0, y: 0 },
        data: roundData as unknown as Record<string, unknown>,
      })
      pushColumns(fan.ids, fan.packed, fan.slots)
    })
  } else if (turnFan) {
    pushColumns(columnIds, turnFan.packed, turnFan.slots)
  }
  if (findingsData) {
    nodes.push({
      id: 'findings',
      type: 'findings',
      position: { x: 0, y: 0 },
      data: findingsData as Record<string, unknown>,
    })
  }

  if (spine) {
    edges.push(edge('framing', 'c-bottom', roundIds[0]!, 'c-top'))
    visible.forEach((_, i) => {
      const roundId = roundIds[i]!
      const { ids } = fans[i]!
      const next = i < visible.length - 1 ? roundIds[i + 1]! : convergeId
      if (ids.length > 0) {
        ids.forEach((cid) => edges.push(edge(roundId, 'c-bottom', cid, 'in', 'split')))
        if (next) ids.forEach((cid) => edges.push(edge(cid, 'out', next, 'c-top', 'merge')))
      } else if (next) {
        edges.push(edge(roundId, 'c-bottom', next, 'c-top'))
      }
    })
  } else {
    const fanFrom = 'framing'
    if (columnIds.length > 0) {
      columnIds.forEach((cid) => edges.push(edge(fanFrom, 'c-bottom', cid, 'in', 'split')))
      if (convergeId)
        columnIds.forEach((cid) => edges.push(edge(cid, 'out', convergeId, 'c-top', 'merge')))
    } else if (convergeId) {
      edges.push(edge(fanFrom, 'c-bottom', convergeId, 'c-top'))
    }
  }

  const rows: string[][] = [['framing']]
  if (spine) {
    fans.forEach((fan, i) => {
      rows.push([roundIds[i]!])
      if (fan.ids.length > 0) rows.push(fan.ids)
    })
  } else if (columnIds.length > 0) {
    rows.push(columnIds)
  }
  if (findingsData) rows.push(['findings'])

  return { nodes, edges, rows }
}

export function sameNodeData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'function' && typeof b === 'function') return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false
    for (const [key, value] of a) if (!b.has(key) || !sameNodeData(value, b.get(key))) return false
    return true
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false
    for (const value of a) if (!b.has(value)) return false
    return true
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)) || a.length !== b.length) return false
    return a.every((value, i) => sameNodeData(value, b[i]))
  }
  const aFields: Record<string, unknown> = { ...a }
  const bFields: Record<string, unknown> = { ...b }
  const keys = Object.keys(aFields)
  if (keys.length !== Object.keys(bFields).length) return false
  return keys.every((key) => key in bFields && sameNodeData(aFields[key], bFields[key]))
}

export function animateFrontier(edges: Edge[], newestRow: readonly string[]): Edge[] {
  if (newestRow.length === 0) return edges
  const frontier = new Set(newestRow)
  return edges.map((e) => (frontier.has(e.target) ? { ...e, animated: true } : e))
}

export function keepEdgeIdentity(prev: readonly Edge[], next: Edge[]): Edge[] {
  if (prev.length === 0) return next
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const kept = next.map((e) => {
    const old = prevById.get(e.id)
    return old && sameNodeData(old, e) ? old : e
  })
  const unchanged = kept.length === prev.length && kept.every((e, i) => e === prev[i])
  return unchanged ? (prev as Edge[]) : kept
}
