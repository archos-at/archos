import type { StoredAction, StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { lookStepPlace, type LookStepGroup, type LookStepPlace } from './look-steps'
import type { RetrievalRound } from './retrieval-rounds'
import type { WorkFold } from './work-sentence'

export const MAX_ROWS = 5
export const KEPT_ROWS = 3
export const FOLD_FROM = 3

export interface WorkRow {
  id: string
  action: StoredAction
  running: boolean
  callIds: string[]
  fold?: WorkFold
  looks: LookStepPlace[]
}

export interface WorkRound {
  round: number
  rows: WorkRow[]
  more: WorkRow[]
  strayLooks: StoredThinkingStep[]
  running: boolean
}

const startOf = (step: StoredThinkingStep): number => {
  const ms = Date.parse(step.timestamp)
  return Number.isFinite(ms) ? ms : 0
}

const isRunning = (step: StoredThinkingStep, action: StoredAction): boolean =>
  !step.isComplete && action.status === 'running'

export const isInterrupted = (row: WorkRow): boolean => !row.running && row.action.status === 'running'

const isLookOf = (action: StoredAction, place: LookStepPlace): boolean => {
  if (action.documentId && place.place.document.id)
    return action.documentId === place.place.document.id
  return Boolean(action.target) && action.target === place.place.document.name
}

export const prefetchRounds = (steps: readonly StoredThinkingStep[]): Set<number> =>
  new Set(
    steps.flatMap((step) =>
      step.kind === 'retrieval' && step.round !== undefined && step.detail?.prefetch === true
        ? [step.round]
        : []
    )
  )

const severity = (row: WorkRow): number => {
  if (row.running) return 2
  if (row.action.status === 'error') return 0
  return row.action.status === 'empty' || row.action.incomplete || isInterrupted(row) ? 1 : 3
}

const sum = (values: Array<number | undefined>): number | undefined =>
  values.some((value) => value !== undefined)
    ? values.reduce<number>((a, b) => a + (b ?? 0), 0)
    : undefined

const opensFolder = (action: WorkRow['action']): boolean =>
  action.verb === 'list' && Boolean(action.mount) && !action.query

const foldKey = (row: WorkRow): string | null =>
  row.running ||
  row.action.status !== 'ok' ||
  row.action.incomplete ||
  row.looks.length > 0 ||
  opensFolder(row.action)
    ? null
    : `${row.action.verb}:${row.action.mode ?? ''}:${row.action.mount && row.action.query ? 'pattern' : ''}`

export function foldRows(rows: readonly WorkRow[]): WorkRow[] {
  const groups = new Map<string, WorkRow[]>()
  for (const row of rows) {
    const key = foldKey(row)
    if (key) groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const out: WorkRow[] = []
  for (const row of rows) {
    const key = foldKey(row)
    const group = key ? groups.get(key) : undefined
    if (!group || group.length < FOLD_FROM) {
      out.push(row)
      continue
    }
    if (group[0] !== row) continue
    const counts = {
      hits: sum(group.map((member) => member.action.counts?.hits)),
      files: sum(group.map((member) => member.action.counts?.files)),
      folders: sum(group.map((member) => member.action.counts?.folders)),
    }
    out.push({
      ...row,
      callIds: group.flatMap((member) => member.callIds),
      fold: {
        count: group.length,
        counts: Object.fromEntries(
          Object.entries(counts).filter(([, value]) => value !== undefined)
        ),
      },
    })
  }
  return out
}

export function limitRows(rows: readonly WorkRow[]): { rows: WorkRow[]; more: WorkRow[] } {
  if (rows.length <= MAX_ROWS) return { rows: [...rows], more: [] }
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => severity(a.row) - severity(b.row) || a.index - b.index)
  return {
    rows: ranked.slice(0, KEPT_ROWS).map(({ row }) => row),
    more: ranked.slice(KEPT_ROWS).map(({ row }) => row),
  }
}

export function workRounds(steps: readonly StoredThinkingStep[]): WorkRound[] {
  const prefetch = prefetchRounds(steps)
  const byRound = new Map<
    number,
    { rows: Array<{ row: WorkRow; start: number }>; looks: StoredThinkingStep[] }
  >()
  const slot = (round: number) => {
    const known = byRound.get(round)
    if (known) return known
    const created = { rows: [], looks: [] }
    byRound.set(round, created)
    return created
  }
  let pending: StoredThinkingStep[] = []
  const place = (round: number, step: StoredThinkingStep) => {
    if (step.kind === 'look') {
      slot(round).looks.push(step)
      return
    }
    if (!step.action) return
    slot(round).rows.push({
      start: startOf(step),
      row: {
        id: step.id,
        action: step.action,
        running: isRunning(step, step.action),
        callIds: step.callId ? [step.callId] : [],
        looks: [],
      },
    })
  }
  let current = 0
  let latest = 0
  for (const step of steps) {
    if (step.scope === 'deep') continue
    if (step.round !== undefined) latest = Math.max(latest, step.round)
    const call = (step.kind === 'action' && step.action) || step.kind === 'look'
    if (!call) continue
    if (step.round !== undefined) {
      current = step.round
      if (prefetch.has(current)) continue
      for (const waiting of pending) place(current, waiting)
      pending = []
      place(current, step)
      continue
    }
    if (prefetch.has(current)) pending.push(step)
    else place(current, step)
  }
  const own = prefetch.has(latest) ? latest + 1 : latest
  for (const waiting of pending) place(own, waiting)

  const rounds: WorkRound[] = []
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const { rows: drafts, looks } = byRound.get(round)!
    if (drafts.length === 0) continue
    const places = looks.flatMap((step) => lookStepPlace(step) ?? [])
    const used = new Set<string>()
    const rows = [...drafts]
      .sort((a, b) => a.start - b.start)
      .map(({ row }) => {
        if (row.action.verb !== 'look') return row
        const mine = places.filter((place) => !used.has(place.id) && isLookOf(row.action, place))
        for (const place of mine) used.add(place.id)
        return { ...row, looks: mine }
      })
    const limited = limitRows(foldRows(rows))
    rounds.push({
      round,
      ...limited,
      strayLooks: looks.filter((step) => !used.has(step.id)),
      running: rows.some((row) => row.running),
    })
  }
  return rounds
}

export function lookGroupRow(group: LookStepGroup): WorkRow {
  const [first] = group.looks
  const { document } = group
  return {
    id: group.key,
    action: {
      verb: 'look',
      status: 'ok',
      target: document.name,
      ...(document.id ? { documentId: document.id } : {}),
      ...(document.shelf === 'base' ? { shelf: 'base' } : {}),
      ...(group.looks.length === 1
        ? { pages: String(first.place.page) }
        : { counts: { hits: group.looks.length } }),
    },
    running: false,
    callIds: [],
    looks: group.looks,
  }
}

export const allRows = (round: WorkRound): WorkRow[] => [...round.rows, ...round.more]

export const placedLookIds = (rounds: readonly WorkRound[]): Set<string> =>
  new Set(
    rounds.flatMap((round) => [
      ...allRows(round).flatMap((row) => row.looks.map((look) => look.id)),
      ...round.strayLooks.map((step) => step.id),
    ])
  )

export function withActionRounds(
  rounds: readonly RetrievalRound[],
  steps: readonly StoredThinkingStep[]
): RetrievalRound[] {
  const known = new Set(rounds.map((round) => round.index))
  const extra = new Map<number, RetrievalRound>()
  for (const round of workRounds(steps)) {
    if (known.has(round.round)) continue
    extra.set(round.round, { index: round.round, key: 'action', tools: [], sourceNames: [] })
  }
  return extra.size === 0
    ? [...rounds]
    : [...rounds, ...extra.values()].sort((a, b) => a.index - b.index)
}

export const hasActions = (steps: readonly StoredThinkingStep[]): boolean =>
  steps.some((step) => step.kind === 'action' && step.action && step.scope !== 'deep')

export interface LinkSelection {
  key: string
  callIds: readonly string[]
}

export const isLinked = (selection: LinkSelection | null, callIds: readonly string[]): boolean =>
  selection !== null && callIds.some((id) => selection.callIds.includes(id))

export function callIdsByDocument(
  steps: readonly StoredThinkingStep[],
  normalize: (name: string) => string
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const step of steps) {
    if (step.kind !== 'sources' || !step.callId) continue
    for (const lane of step.traceLanes ?? []) {
      for (const source of lane.sources) {
        for (const name of [source.name, source.title]) {
          const key = name ? normalize(name) : ''
          if (!key) continue
          const known = out.get(key) ?? []
          if (!known.includes(step.callId)) out.set(key, [...known, step.callId])
        }
      }
    }
  }
  return out
}

export type WorkKind = 'search' | 'read' | 'list' | 'look' | 'model' | 'workspace'

const SEARCH_VERBS: ReadonlySet<StoredAction['verb']> = new Set(['search', 'lookup', 'law', 'web'])

export function workKind(round: WorkRound): WorkKind {
  const verbs = allRows(round).map((row) => row.action.verb)
  if (verbs.some((verb) => SEARCH_VERBS.has(verb))) return 'search'
  if (verbs.includes('read')) return 'read'
  const first = verbs[0]
  return first === 'list' || first === 'look' || first === 'model' || first === 'workspace'
    ? first
    : 'read'
}
