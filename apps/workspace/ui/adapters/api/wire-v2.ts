import { z } from 'zod'
import { discriminatedOptions } from '@/lib/api/zod-union'
import {
  clientMessageSchema,
  heartbeatSchema,
  helloSchema,
  shownAnswerSchema,
  stepStartedSchema,
  wireEventSchema,
} from './wire-v2.generated'

export {
  answerSnapshotSchema,
  clientMessageSchema,
  helloSchema,
  keyedCardSchema,
  traceLaneSchema,
  turnResultSchema,
  wireEventSchema,
} from './wire-v2.generated'

export const WIRE_VERSION = 2

export const CLOSE_CLIENT_OUTDATED = 4426

export const MAX_VIEWER_PASSAGE_CHARS = 400

export type UnknownWireEvent = z.infer<typeof unknownEnvelopeSchema> & {
  type: 'UNKNOWN'
  of: string
}

export type WireEvent = z.infer<typeof wireEventSchema> | UnknownWireEvent
export type Hello = z.infer<typeof helloSchema>
export type ClientMessage = z.input<typeof clientMessageSchema>
export type ShownAnswer = z.input<typeof shownAnswerSchema>

export type WireEventType = WireEvent['type']
export type CustomEvent = Extract<WireEvent, { type: 'CUSTOM' }>
export type CustomEventName = CustomEvent['name']
export type StepEvent = Extract<WireEvent, { type: 'STEP_STARTED' | 'STEP_FINISHED' }>
export type Step = StepEvent['step']
export type StepKind = Step['kind']
export type TurnResult = Extract<WireEvent, { type: 'RUN_FINISHED' }>['result']

const [byType, byName] = wireEventSchema.options
const KNOWN_TYPES: ReadonlySet<unknown> = new Set([...discriminatedOptions(byType).keys(), 'CUSTOM'])
const KNOWN_CUSTOM_NAMES: ReadonlySet<unknown> = new Set(discriminatedOptions(byName).keys())
const KNOWN_STEP_KINDS: ReadonlySet<unknown> = new Set(
  discriminatedOptions(stepStartedSchema.shape.step).keys()
)

const unknownEnvelopeSchema = heartbeatSchema
  .omit({ name: true, value: true, type: true })
  .extend({ v: z.literal(2) })

const unknownPart = (raw: Record<string, unknown>): string | null => {
  const { type } = raw
  if (typeof type !== 'string') return null
  if (!KNOWN_TYPES.has(type)) return type
  if (type === 'CUSTOM') {
    return typeof raw.name === 'string' && !KNOWN_CUSTOM_NAMES.has(raw.name)
      ? `CUSTOM:${raw.name}`
      : null
  }
  if (type !== 'STEP_STARTED' && type !== 'STEP_FINISHED') return null
  const kind = (raw.step as { kind?: unknown } | null | undefined)?.kind
  return typeof kind === 'string' && !KNOWN_STEP_KINDS.has(kind) ? `${type}:${kind}` : null
}

export const parseWireEvent = (raw: unknown): WireEvent | null => {
  const parsed = wireEventSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  if (!raw || typeof raw !== 'object') return null
  const of = unknownPart(raw as Record<string, unknown>)
  const envelope = of === null ? null : unknownEnvelopeSchema.safeParse(raw)
  return of !== null && envelope?.success ? { ...envelope.data, type: 'UNKNOWN', of } : null
}

export const parseHello = (raw: unknown): Hello | null => {
  const parsed = helloSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
