import type { GeneratedContent } from './ai-generated-meta'
import type { z } from 'zod'
import type { OperationInput } from './dispatch'

export type BodyEncoding = 'json' | 'multipart' | 'raw'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RouteHandler = (
  request: Request,
  context?: { params?: Promise<Record<string, string | string[]>> },
) => Promise<Response>

export type RouteModule = Partial<Record<HttpMethod, RouteHandler>>

export const AGENT_DOMAINS = [
  'projects',
  'documents',
  'folders',
  'mail',
  'review',
  'conversations',
  'collaboration',
  'tasks',
  'skills',
  'knowledge',
  'bim',
  'organization',
  'platform',
] as const

export type AgentDomain = (typeof AGENT_DOMAINS)[number]

export interface AgentOperation {
  readonly name: string
  readonly domain: AgentDomain
  readonly summary: string
  readonly description: string
  readonly method: HttpMethod
  readonly path: `/api/${string}`
  readonly load: () => Promise<RouteModule>
  readonly params?: z.ZodObject
  readonly query?: z.ZodObject
  readonly body?: z.ZodType
  readonly bodyEncoding?: BodyEncoding
  readonly binaryResponse?: readonly string[]
  readonly readOnly?: boolean
  readonly destructive?: boolean
  readonly personDecides?: true
  readonly personDecidesWhen?: (input: OperationInput) => boolean
  readonly idempotent?: boolean
  readonly ifMatchHeader?: true
  readonly examples?: readonly OperationExample[]
  readonly sensitivity?: Sensitivity
  readonly requiresPersonConfirmation?: PersonConfirmation
  readonly spansProjects?: SpansProjects
  readonly inputDefaults?: OperationExample
  readonly rewriteInput?: (given: OperationExample) => OperationExample
  readonly links?: LinkKind
  readonly generatedContent?: GeneratedContent
}

export type LinkKind = 'project' | 'document' | 'task-run' | 'conversation' | 'inbound-mail'

export type SpansProjects = 'always' | 'unlessScoped'

export interface OperationExample {
  readonly params?: Record<string, string>
  readonly query?: Record<string, unknown>
  readonly body?: unknown
}

export interface PersonConfirmation {
  readonly decideAt: (input: OperationInput) => `/app/${string}`
}

export const SENSITIVITIES = ['access', 'secret', 'control'] as const
export type Sensitivity = (typeof SENSITIVITIES)[number]

export interface ToolAnnotations {
  readonly title: string
  readonly readOnlyHint: boolean
  readonly destructiveHint: boolean
  readonly idempotentHint: boolean
  readonly openWorldHint: false
}

export function annotationsOf(op: AgentOperation): ToolAnnotations {
  const readOnlyHint = op.readOnly ?? op.method === 'GET'
  return {
    title: op.summary,
    readOnlyHint,
    destructiveHint:
      op.sensitivity !== undefined ||
      op.requiresPersonConfirmation !== undefined ||
      (!readOnlyHint && (op.destructive ?? op.method === 'DELETE')),
    idempotentHint: readOnlyHint || (op.idempotent ?? (op.method === 'PUT' || op.method === 'DELETE')),
    openWorldHint: false,
  }
}

export function pathParams(path: string): string[] {
  return [...path.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((match) => match[1] as string)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function mergeSlot(defaults: unknown, given: unknown): unknown {
  if (!isPlainObject(defaults)) return given
  if (given === undefined) return defaults
  if (!isPlainObject(given)) return given
  const merged: Record<string, unknown> = { ...defaults, ...given }
  for (const [key, value] of Object.entries(defaults)) {
    if (isPlainObject(value) && isPlainObject(given[key])) merged[key] = { ...value, ...given[key] }
  }
  return merged
}

export function withInputDefaults<T extends OperationExample>(input: T, defaults: OperationExample | undefined): T {
  if (!defaults) return input
  return {
    ...input,
    ...(defaults.params ? { params: mergeSlot(defaults.params, input.params) as Record<string, string> } : {}),
    ...(defaults.query ? { query: mergeSlot(defaults.query, input.query) as Record<string, unknown> } : {}),
    ...(defaults.body ? { body: mergeSlot(defaults.body, input.body) } : {}),
  }
}
