import type { RecordedFrame, RecordedTurn } from './stream-frames'

export interface TimedBody {
  at: number
  body: Record<string, unknown>
}

export interface TimedFrame {
  at: number
  frame: Record<string, unknown>
}

const cardKey = (card: unknown): string => {
  let hash = 0x811c9dc5
  for (const char of JSON.stringify(card)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

export const keyed = (cards: readonly unknown[] = []) => cards.map((card) => ({ key: cardKey(card), card }))

const RESULT_FIELDS = [
  'sources',
  'answer_meta',
  'answer_confidence',
  'answer_confidence_reason',
  'routing_decision',
  'read_sources',
  'retrieval_ledger',
  'skills_activated',
] as const

export const resultOf = (frame: RecordedFrame, messageId: string): Record<string, unknown> => ({
  message_id: messageId,
  text: frame.content,
  cards: keyed(frame.cards),
  ...Object.fromEntries(RESULT_FIELDS.filter((field) => frame[field] != null).map((field) => [field, frame[field]])),
})

export const answerBodies = (turn: RecordedTurn, messageId: string, start = 0, speed = 1): TimedBody[] => {
  const t0 = turn.frames[0]?.t ?? 0
  const out: TimedBody[] = []
  let streaming = false
  for (const frame of turn.frames) {
    const at = start + Math.round(((frame.t - t0) * 1000) / speed)
    const push = (body: Record<string, unknown>) => out.push({ at, body })
    if (frame.status === 'complete') {
      if (streaming) push({ type: 'TEXT_MESSAGE_END', message_id: messageId })
      push({ type: 'RUN_FINISHED', outcome: 'answered', result: resultOf(frame, messageId) })
      continue
    }
    if (frame.stream_replace) {
      const meta = frame.answer_meta ? { answer_meta: frame.answer_meta } : {}
      push({ type: 'STATE_SNAPSHOT', snapshot: { text: frame.content, sources: frame.sources ?? [], ...meta } })
    } else if (frame.content) {
      if (!streaming) push({ type: 'TEXT_MESSAGE_START', message_id: messageId })
      streaming = true
      push({ type: 'TEXT_MESSAGE_CONTENT', message_id: messageId, delta: frame.content })
    } else if (frame.answer_meta) {
      push({ type: 'CUSTOM', name: 'masthead', value: { answer_meta: frame.answer_meta } })
    }
    keyed(frame.cards).forEach(({ key, card }, index) =>
      push({ type: 'CUSTOM', name: 'card', value: { index, key, card } })
    )
  }
  return out
}

export const asSettled = (bodies: readonly TimedBody[]): TimedBody[] => {
  const snapshot = bodies.findLast(({ body }) => body.type === 'STATE_SNAPSHOT')?.body.snapshot as
    | { text: string; sources: unknown[]; answer_meta?: unknown }
    | undefined
  if (!snapshot) return [...bodies]
  const streamed = new Map<number, unknown>()
  for (const { body } of bodies) {
    if (body.name !== 'card') continue
    const value = body.value as { index: number; key: string; card: unknown }
    streamed.set(value.index, { key: value.key, card: value.card })
  }
  const cards = [...streamed.entries()].sort(([a], [b]) => a - b).map(([, card]) => card)
  const meta = snapshot.answer_meta ? { answer_meta: snapshot.answer_meta } : {}
  return bodies.map(({ at, body }) => {
    if (body.type !== 'RUN_FINISHED') return { at, body }
    const result = { ...(body.result as object), text: snapshot.text, sources: snapshot.sources, cards, ...meta }
    return { at, body: { ...body, result } }
  })
}

const QUERIES = ['OIB-Richtlinie 2 Geltungsbereich', 'OIB-RL 2 Ausgabe 2023 Abweichungen Landesrecht', 'Brandschutz Fluchtwege Gebäudeklassen']
export const HEARTBEAT_MS = 20_000
const ROUND_MS = 4_000

const lanes = (round: number) => [
  {
    key: 'building_law_oib',
    label: 'OIB-Richtlinie',
    kind: 'building_law',
    hit_count: 6,
    sources: [
      { name: 'oib-rl_2_ausgabe_mai_2023.pdf', title: 'OIB-Richtlinie 2, Ausgabe Mai 2023', detail: `p.${4 + round}`, shelf: 'base', round },
      ...Array.from({ length: 5 }, (_, i) => ({ name: `oib-rl_2_erlaeuterungen_${i + 1}.pdf`, detail: `p.${10 + i}`, shelf: 'base', round })),
    ],
  },
  {
    key: 'project',
    label: 'Projektwissen',
    kind: 'project',
    hit_count: 3,
    sources: Array.from({ length: 3 }, (_, i) => ({ name: `Brandschutzkonzept_Stiege_${i + 1}.pdf`, detail: `p.${3 + i}`, shelf: 'project', round })),
  },
]

export const stepBodies = (): { bodies: TimedBody[]; answerStart: number } => {
  const bodies: TimedBody[] = [
    { at: 40, body: { type: 'STEP_FINISHED', step: { id: 'status:documents', kind: 'status', slot: 'documents', key: 'status.documents.project' } } },
  ]
  QUERIES.forEach((query, round) => {
    const at = 200 + round * ROUND_MS
    const tool = { id: `tool:call_${round}`, kind: 'tool', tool: 'knowledge_search' }
    bodies.push(
      { at, body: { type: 'STEP_FINISHED', step: { id: `status:retrieval:${round}`, kind: 'retrieval', round, key: 'status.retrieval.withQuery', values: { corpus: 'knowledge', query }, tools: ['knowledge_search'] } } },
      { at: at + 2_000, body: { type: 'STEP_STARTED', step: tool } },
      { at: at + 3_400, body: { type: 'STEP_FINISHED', step: { id: `sources:${round}:knowledge_search:1`, kind: 'sources', round, tool: 'knowledge_search', lanes: lanes(round) } } },
      { at: at + 3_405, body: { type: 'STEP_FINISHED', step: { ...tool, status: 'ok' } } }
    )
  })
  const synthesis = 200 + QUERIES.length * ROUND_MS
  bodies.push({ at: synthesis, body: { type: 'STEP_FINISHED', step: { id: 'status:synthesis', kind: 'status', slot: 'synthesis', key: 'status.synthesis' } } })
  return { bodies, answerStart: synthesis + 300 }
}

export const v2Turn = (
  turn: RecordedTurn,
  ids: { conversationId: string; turnId: string; messageId: string },
  speed = 1
): TimedFrame[] => {
  const { bodies, answerStart } = stepBodies()
  return stampTurn([...bodies, ...answerBodies(turn, ids.messageId, answerStart, speed)], ids)
}

export const stampTurn = (
  bodies: readonly TimedBody[],
  ids: { conversationId: string; turnId: string; messageId: string }
): TimedFrame[] => {
  const end = Math.max(0, ...bodies.map(({ at }) => at))
  const answered = bodies.some(({ body }) => body.type === 'RUN_FINISHED')
  const all: TimedBody[] = [{ at: 0, body: { type: 'RUN_STARTED', message_id: ids.messageId } }, ...bodies]
  if (answered) all.push({ at: end + 900, body: { type: 'CUSTOM', name: 'stage', value: { stage: 'memory_reflection', status: 'empty' } } })
  for (let at = HEARTBEAT_MS; at < end; at += HEARTBEAT_MS) {
    all.push({ at, body: { type: 'CUSTOM', name: 'heartbeat', value: { every_ms: HEARTBEAT_MS } } })
  }
  all.sort((a, b) => a.at - b.at)
  return all.map(({ at, body }, index) => ({ at, frame: stampFrame(index + 1, body, ids) }))
}

export const stampFrame = (
  seq: number,
  body: Record<string, unknown>,
  ids: { conversationId: string; turnId: string }
): Record<string, unknown> => ({ v: 2, conversation_id: ids.conversationId, turn_id: ids.turnId, seq, ts: 0, ...body })
