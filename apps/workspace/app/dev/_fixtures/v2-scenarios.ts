import { CARD_PREVIEW_FIXTURES } from '@/features/cards/preview-fixtures'
import type { RecordedTurn } from './stream-frames'
import { answerBodies, asSettled, keyed, stampTurn, stepBodies, type TimedBody, type TimedFrame } from './v2-turn'

export const STREAM_SCENARIOS = [
  'happy',
  'cards-only',
  'masthead-first',
  'shallow',
  'opens-table',
  'opens-card',
  'one-line',
  'long',
  'two-turns',
  'retract-with-card',
  'rewrite',
] as const
export type StreamScenario = (typeof STREAM_SCENARIOS)[number]

export const ERROR_PHASES = ['preack', 'steps', 'prose', 'finish'] as const
export type ErrorPhase = (typeof ERROR_PHASES)[number]

export const isStreamScenario = (value: string | null): value is StreamScenario =>
  STREAM_SCENARIOS.includes(value as StreamScenario)
export const isErrorPhase = (value: string | null): value is ErrorPhase => ERROR_PHASES.includes(value as ErrorPhase)

type Ids = { conversationId: string; turnId: string; messageId: string }

const CARDS = [CARD_PREVIEW_FIXTURES.egress_diagram, CARD_PREVIEW_FIXTURES.calculation].filter(Boolean)

const cardBody = (at: number, index: number): TimedBody => {
  const [{ key, card }] = keyed([CARDS[index % CARDS.length]])
  return { at, body: { type: 'CUSTOM', name: 'card', value: { index, key, card } } }
}

const isDelta = ({ body }: TimedBody) => body.type === 'TEXT_MESSAGE_CONTENT'
const textOf = (bodies: readonly TimedBody[]) => bodies.filter(isDelta).map(({ body }) => String(body.delta)).join('')

const shift = (bodies: readonly TimedBody[], by: number): TimedBody[] => bodies.map(({ at, body }) => ({ at: at + by, body }))

const withProse = (answer: readonly TimedBody[], deltas: readonly TimedBody[], messageId: string): TimedBody[] => {
  const recorded = answer.filter(isDelta)
  const lastRecorded = recorded.at(-1)?.at ?? 0
  const lastNew = deltas.at(-1)?.at ?? lastRecorded
  const text = textOf(deltas)
  const head = answer.filter(({ body, at }) => at <= (recorded[0]?.at ?? 0) && !isDelta({ at, body }))
  const tail = shift(
    answer.filter(({ at, body }) => at > lastRecorded && !isDelta({ at, body })),
    lastNew - lastRecorded
  ).map(({ at, body }) => ({ at, body: retext(body, text, messageId) }))
  return [...head, ...deltas, ...tail]
}

const retext = (body: Record<string, unknown>, text: string, messageId: string): Record<string, unknown> => {
  if (body.type === 'STATE_SNAPSHOT') return { ...body, snapshot: { ...(body.snapshot as object), text } }
  if (body.type === 'RUN_FINISHED') return { ...body, result: { ...(body.result as object), message_id: messageId, text } }
  return body
}

const delta = (at: number, text: string, messageId: string): TimedBody => ({
  at,
  body: { type: 'TEXT_MESSAGE_CONTENT', message_id: messageId, delta: text },
})

const chunked = (text: string, start: number, messageId: string, every = 90): TimedBody[] =>
  (text.match(/(?:\S+\s*){1,4}|\s+/g) ?? []).map((chunk, index) => delta(start + index * every, chunk, messageId))

const TABLE = [
  '| Nachweis | Anforderung | Fundstelle |',
  '|---|---|---|',
  '| Tragende Bauteile | R 60 | Tabelle 1b |',
  '| Trennwände | REI 60 | Tabelle 1b |',
  '| Treppenhauswände | REI 90 | Pkt. 5.1 |',
  '| Fluchtweglänge | ≤ 40 m | Pkt. 5.1.1 |',
]

const ONE_LINE = 'Ja, die OIB-Richtlinie 2 gilt für alle Gebäudeklassen.'

const scenarioBodies = (name: StreamScenario, turn: RecordedTurn, messageId: string, speed: number): TimedBody[] => {
  const { bodies: steps, answerStart } = stepBodies()
  const recorded = answerBodies(turn, messageId, answerStart, speed)
  const answer = asSettled(recorded)
  const deltas = answer.filter(isDelta)
  const firstDelta = deltas[0]?.at ?? answerStart
  switch (name) {
    case 'happy':
    case 'two-turns':
      return [...steps, ...answer]
    case 'cards-only': {
      const finished = answer.find(({ body }) => body.type === 'RUN_FINISHED')!
      const result = {
        ...(finished.body.result as object),
        message_id: messageId,
        text: '',
        sources: [],
        answer_meta: undefined,
        cards: keyed(CARDS),
      }
      return [
        ...steps,
        cardBody(answerStart, 0),
        cardBody(answerStart + 700, 1),
        { at: answerStart + 1_600, body: { type: 'RUN_FINISHED', outcome: 'answered', result } },
      ]
    }
    case 'masthead-first': {
      const masthead = answer.filter(({ body }) => body.name === 'masthead')
      const rest = answer.filter(({ body }) => body.name !== 'masthead')
      return [...steps, ...masthead.map(({ body }) => ({ at: answerStart, body })), ...shift(rest, 1_500)]
    }
    case 'shallow':
      return asSettled(answerBodies(turn, messageId, 600, speed))
    case 'opens-table': {
      const rows = TABLE.flatMap((row) => {
        const middle = row.indexOf('|', Math.floor(row.length / 2))
        return middle > 0 ? [row.slice(0, middle), `${row.slice(middle)}\n`] : [`${row}\n`]
      })
      const table = rows.map((chunk, index) => delta(firstDelta + index * 120, chunk, messageId))
      const after = (table.at(-1)?.at ?? firstDelta) + 120
      const prose = [delta(after, '\n', messageId), ...shift(deltas, after + 60 - firstDelta)]
      return [...steps, ...withProse(answer, [...table, ...prose], messageId)]
    }
    case 'opens-card': {
      const card = cardBody(firstDelta - 200, 0)
      const prose = [delta(firstDelta, '[[card:1]]\n\n', messageId), ...shift(deltas, 80)]
      return [...steps, card, ...withProse(answer, prose, messageId).map((b) => withCards(b, 1))]
    }
    case 'one-line':
      return [...steps, ...withProse(answer, [delta(firstDelta, ONE_LINE, messageId)], messageId)]
    case 'long': {
      const span = (deltas.at(-1)?.at ?? firstDelta) - firstDelta + 400
      const copies = Array.from({ length: 6 }, (_, copy) => [
        ...(copy > 0 ? [delta(firstDelta + copy * span - 100, '\n\n', messageId)] : []),
        ...shift(deltas, copy * span),
      ]).flat()
      return [...steps, ...withProse(answer, copies, messageId)]
    }
    case 'retract-with-card': {
      const preamble = chunked('Ich prüfe dazu die Gehweglänge im Erdgeschoß:\n\n[[card:1]]', firstDelta, messageId)
      const preambleEnd = preamble.at(-1)!.at
      const retractAt = preambleEnd + 2_500
      return [
        ...steps,
        { at: firstDelta, body: { type: 'TEXT_MESSAGE_START', message_id: messageId } },
        ...preamble,
        cardBody(preambleEnd + 300, 0),
        { at: preambleEnd + 400, body: { type: 'TEXT_MESSAGE_END', message_id: messageId } },
        { at: retractAt, body: { type: 'CUSTOM', name: 'answer_retracted', value: {} } },
        ...shift(answer, retractAt + 1_200 - answerStart),
      ]
    }
    case 'rewrite':
      return [...steps, ...recorded]
  }
}

const withCards = (timed: TimedBody, count: number): TimedBody => {
  if (timed.body.type !== 'RUN_FINISHED') return timed
  const result = { ...(timed.body.result as object), cards: keyed(CARDS.slice(0, count)) }
  return { at: timed.at, body: { ...timed.body, result } }
}

export const failAt = (bodies: readonly TimedBody[], phase: ErrorPhase): TimedBody[] => {
  const sorted = [...bodies].sort((a, b) => a.at - b.at)
  const deltas = sorted.filter(isDelta)
  const firstSources = sorted.find(({ body }) => (body.step as { kind?: string } | undefined)?.kind === 'sources')
  const finishAt = sorted.find(({ body }) => body.type === 'RUN_FINISHED')?.at ?? sorted.at(-1)?.at ?? 0
  const lastSent = {
    preack: -1,
    steps: firstSources?.at ?? -1,
    prose: deltas[Math.floor(deltas.length / 2)]?.at ?? finishAt,
    finish: finishAt,
  }[phase]
  const kept = sorted.filter(({ at, body }) => at <= lastSent && body.type !== 'RUN_FINISHED')
  const error = {
    type: 'RUN_ERROR',
    code: 'workflow_error',
    message: 'The model provider closed the connection.',
    details: null,
  }
  return [...kept, { at: phase === 'preack' ? 300 : lastSent + 1, body: error }]
}

export const v2Scenario = (
  name: StreamScenario,
  turn: RecordedTurn,
  ids: Ids,
  speed = 1,
  error?: ErrorPhase
): TimedFrame[] => {
  const bodies = scenarioBodies(name, turn, ids.messageId, speed)
  return stampTurn(error ? failAt(bodies, error) : bodies, ids)
}
