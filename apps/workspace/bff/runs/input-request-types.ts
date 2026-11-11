/**
 * A run's question to a person, and the answer (ADR-0181): the contract.
 *
 * A run that cannot go on without a person stores an input request. The shape
 * is the standards' so nothing is translated at a door: what is asked follows
 * MCP form elicitation (a `message` and a flat `requestedSchema`), why it is
 * asked follows AG-UI's interrupt (`reason`, `expiresAt`), and how it ends maps
 * onto both (`answered` is MCP `accept` and AG-UI `resolved`; `declined` is MCP
 * `decline`; `cancelled` is the run withdrawing it; `expired` is its deadline).
 *
 * No `server-only` and no drizzle: the route handlers, the browser and the
 * agent catalog read this module, as they read `./run-ledger-types`.
 */

import { z } from 'zod'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** How a request stands. `open` is the only state a person can still act on. */
export const INPUT_REQUEST_STATUSES = ['open', 'answered', 'declined', 'cancelled', 'expired'] as const
export type InputRequestStatus = (typeof INPUT_REQUEST_STATUSES)[number]

/** The states a person's act leaves behind: these carry who decided. */
export const PERSON_DECIDED_STATUSES = ['answered', 'declined'] as const satisfies readonly InputRequestStatus[]

/** Why the run asks (AG-UI's interrupt reasons that involve a person). */
export const INPUT_REQUEST_REASONS = ['input_required', 'confirmation'] as const
export type InputRequestReason = (typeof INPUT_REQUEST_REASONS)[number]

/**
 * The request's status and every move on it (ADR-0179). The first final word
 * stands: a decided request keeps its decision, whoever speaks next (a second
 * tab, a worker that asks to cancel after the answer, the expiry sweep).
 */
export const INPUT_REQUEST_LIFECYCLE = defineLifecycle<InputRequestStatus, 'answer' | 'decline' | 'cancel' | 'expire'>({
  id: 'run-input-request',
  initial: 'open',
  states: {
    open: { on: { answer: 'answered', decline: 'declined', cancel: 'cancelled', expire: 'expired' } },
    answered: { type: 'final' },
    declined: { type: 'final' },
    cancelled: { type: 'final' },
    expired: { type: 'final' },
  },
})

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const MAX_INPUT_MESSAGE_CHARS = 2_000
export const MAX_INPUT_PROPERTIES = 12
export const MAX_INPUT_ENUM_VALUES = 40
export const MAX_INPUT_TEXT_CHARS = 4_000
export const MAX_INPUT_LABEL_CHARS = 200
/** How many requests one run may have open at once: a run asks, it does not interview. */
export const MAX_OPEN_INPUT_REQUESTS = 5
/** Default page of a run's requests, newest first. */
export const INPUT_REQUEST_PAGE_DEFAULT_LIMIT = 20
/** Largest page of a run's requests. */
export const INPUT_REQUEST_PAGE_MAX_LIMIT = 50

const label = z.string().trim().min(1).max(MAX_INPUT_LABEL_CHARS)
const propertyName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'A property name is lower snake case')

// ---------------------------------------------------------------------------
// The requested schema: MCP form elicitation's flat object of primitives
// ---------------------------------------------------------------------------

const annotated = { title: label.optional(), description: label.optional() }

const stringProperty = z
  .object({
    type: z.literal('string'),
    ...annotated,
    enum: z.array(label).min(1).max(MAX_INPUT_ENUM_VALUES).optional(),
    maxLength: z.number().int().min(1).max(MAX_INPUT_TEXT_CHARS).optional(),
  })
  .strict()

const numberProperty = z
  .object({
    type: z.enum(['number', 'integer']),
    ...annotated,
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  })
  .strict()
  .refine((p) => p.minimum === undefined || p.maximum === undefined || p.minimum <= p.maximum, {
    message: 'minimum must not exceed maximum',
  })

const booleanProperty = z.object({ type: z.literal('boolean'), ...annotated }).strict()

export const inputPropertySchema = z.union([stringProperty, numberProperty, booleanProperty])
export type InputProperty = z.infer<typeof inputPropertySchema>

export const requestedSchemaSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(propertyName, inputPropertySchema),
    required: z.array(propertyName).max(MAX_INPUT_PROPERTIES).optional(),
  })
  .strict()
  .superRefine((schema, ctx) => {
    const names = Object.keys(schema.properties)
    if (names.length === 0 || names.length > MAX_INPUT_PROPERTIES) {
      ctx.addIssue({ code: 'custom', message: `A request asks for 1 to ${MAX_INPUT_PROPERTIES} values` })
    }
    for (const name of schema.required ?? []) {
      if (!names.includes(name)) ctx.addIssue({ code: 'custom', message: `required names an unknown property: ${name}` })
    }
  })
export type RequestedSchema = z.infer<typeof requestedSchemaSchema>

/** An answer: one primitive per asked property. */
export const inputContentSchema = z.record(propertyName, z.union([z.string(), z.number(), z.boolean()]))
export type InputContent = z.infer<typeof inputContentSchema>

function valueProblem(name: string, property: InputProperty, value: string | number | boolean): string | null {
  if (property.type === 'boolean') return typeof value === 'boolean' ? null : `${name} must be true or false`
  if (property.type === 'string') {
    if (typeof value !== 'string') return `${name} must be text`
    if (property.enum) return property.enum.includes(value) ? null : `${name} must be one of the offered values`
    const max = property.maxLength ?? MAX_INPUT_TEXT_CHARS
    return value.length <= max ? null : `${name} is longer than ${max} characters`
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a number`
  if (property.type === 'integer' && !Number.isInteger(value)) return `${name} must be a whole number`
  if (property.minimum !== undefined && value < property.minimum) return `${name} must be at least ${property.minimum}`
  if (property.maximum !== undefined && value > property.maximum) return `${name} must be at most ${property.maximum}`
  return null
}

/**
 * What is wrong with an answer for this schema, one sentence per problem; empty
 * when it is valid. Pure, so the route, the form and the tests agree.
 */
export function inputContentProblems(schema: RequestedSchema, content: InputContent): string[] {
  const problems: string[] = []
  for (const name of Object.keys(content)) {
    if (!Object.hasOwn(schema.properties, name)) problems.push(`${name} was not asked for`)
  }
  for (const name of schema.required ?? []) {
    if (!Object.hasOwn(content, name)) problems.push(`${name} is required`)
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(content, name)) continue
    const problem = valueProblem(name, property, content[name])
    if (problem) problems.push(problem)
  }
  return problems
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

const instant = z.string().datetime({ offset: true })

/** What the worker posts to ask. The run is in the path and nowhere in the body. */
export const inputRequestCreateSchema = z
  .object({
    reason: z.enum(INPUT_REQUEST_REASONS),
    message: z.string().trim().min(1).max(MAX_INPUT_MESSAGE_CHARS),
    requestedSchema: requestedSchemaSchema,
    /** After this instant the request can no longer be answered. */
    expiresAt: instant.optional(),
    /**
     * The worker's own key for this question, so a retried post finds the same
     * request instead of asking twice.
     */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  })
  .strict()
export type InputRequestCreate = z.infer<typeof inputRequestCreateSchema>

/** How a person settles one: MCP elicitation's two answers a person gives. */
export const INPUT_REQUEST_ACTIONS = ['accept', 'decline'] as const
export type InputRequestAction = (typeof INPUT_REQUEST_ACTIONS)[number]

/**
 * What a person posts to settle one: an answer (`accept` with `content`), or an
 * explicit no (`decline`, no `content`). One flat object, so the agent catalog
 * describes it as it describes every body; `inputRequestResolveProblem` holds
 * the rule between the two fields.
 */
export const inputRequestResolveSchema = z
  .object({
    action: z.enum(INPUT_REQUEST_ACTIONS).describe('accept: answer with `content`. decline: say no, without `content`.'),
    content: inputContentSchema.optional().describe('One value per asked property, by the property name; only with accept.'),
  })
  .strict()
export type InputRequestResolve = z.infer<typeof inputRequestResolveSchema>

/** What is wrong with the pairing of `action` and `content`, or null. */
export function inputRequestResolveProblem(body: InputRequestResolve): string | null {
  if (body.action === 'accept' && body.content === undefined) return 'accept needs content'
  if (body.action === 'decline' && body.content !== undefined) return 'decline takes no content'
  return null
}

/** One request as every reader is told it. `content` is present exactly when `answered`. */
export const inputRequestViewSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    status: z.enum(INPUT_REQUEST_STATUSES),
    reason: z.enum(INPUT_REQUEST_REASONS),
    message: z.string(),
    requestedSchema: requestedSchemaSchema,
    content: inputContentSchema.optional(),
    createdAt: instant,
    expiresAt: instant.optional(),
    decidedAt: instant.optional(),
    /** The person who answered or declined; absent when the run or the clock ended it. */
    decidedBy: z.string().optional(),
  })
  .strict()
export type InputRequestView = z.infer<typeof inputRequestViewSchema>

/** `GET /api/projects/[id]/runs/[runId]/input-requests`: one keyset page, newest first. */
export const inputRequestListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(INPUT_REQUEST_PAGE_MAX_LIMIT).default(INPUT_REQUEST_PAGE_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(200).optional(),
})
export type InputRequestListQuery = z.infer<typeof inputRequestListQuerySchema>

export const inputRequestListSchema = z
  .object({
    requests: z.array(inputRequestViewSchema).max(INPUT_REQUEST_PAGE_MAX_LIMIT),
    /** Pass as `cursor` for the next page; null on the last. */
    nextCursor: z.string().nullable(),
  })
  .strict()
export type InputRequestList = z.infer<typeof inputRequestListSchema>
