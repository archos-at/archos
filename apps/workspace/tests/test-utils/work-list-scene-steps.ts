export type WireStepInput = Record<string, unknown>

export interface TimedStep {
  at: number
  type: 'STEP_STARTED' | 'STEP_FINISHED'
  step: WireStepInput
}

export const call = (id: string, at: number, ms: number, step: WireStepInput): TimedStep[] => [
  {
    at,
    type: 'STEP_STARTED',
    step: { id, call_id: id, kind: 'action', status: 'running', ...step },
  },
  {
    at: at + ms,
    type: 'STEP_FINISHED',
    step: { id, call_id: id, kind: 'action', elapsed_ms: ms, ...step },
  },
]

export type LaneKind = 'building_law' | 'project' | 'office' | 'web'
export interface Hit {
  name: string
  detail?: string
  kind: LaneKind
}

const LANE: Record<LaneKind, { key: string; label: string }> = {
  building_law: { key: 'building_law_oib', label: 'OIB-Richtlinie' },
  project: { key: 'project', label: 'Projektwissen' },
  office: { key: 'office', label: 'Büroablage' },
  web: { key: 'web', label: 'Web' },
}

export const sourcesOf = (at: number, callId: string, round: number, hits: readonly Hit[]): TimedStep => ({
  at,
  type: 'STEP_FINISHED',
  step: {
    id: `sources:${callId}`,
    kind: 'sources',
    tool: 'knowledge_search',
    round,
    call_id: callId,
    lanes: (Object.keys(LANE) as LaneKind[]).flatMap((kind) => {
      const mine = hits.filter((hit) => hit.kind === kind)
      if (mine.length === 0) return []
      return [
        {
          ...LANE[kind],
          kind,
          hit_count: mine.length,
          sources: mine.map((hit) => ({
            name: hit.name,
            ...(hit.detail ? { detail: hit.detail } : {}),
            shelf: kind === 'building_law' ? 'base' : 'project',
            round,
          })),
        },
      ]
    }),
  },
})

export const retrievalOf = (at: number, round: number, reason?: string, prefetch = false): TimedStep => ({
  at,
  type: 'STEP_FINISHED',
  step: {
    id: `status:retrieval:${round}`,
    kind: 'retrieval',
    round,
    key: 'status.retrieval.withQuery',
    values: { corpus: 'knowledge', query: 'Brandabschnitt' },
    tools: ['knowledge_search'],
    ...(reason ? { reason } : {}),
    ...(prefetch ? { prefetch: true } : {}),
  },
})
