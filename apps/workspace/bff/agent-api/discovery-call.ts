import 'server-only'

import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { isAgentKind } from '@/lib/agent-kind'
import { ApiError } from '@/lib/api/errors'
import { offersAppViews } from './app-host'
import { type BackendOperation, callBackendOperation } from './backend-operations'
import { actingDoorOf } from './call-origin'
import {
  type OperationInput,
  OperationInputError,
  type OperationResult,
  callOperation,
  isRedirectBody,
  validateOperationInput,
} from './dispatch'
import { READ_GATE_DETAIL, problemFailure } from './door-problem'
import { IF_MATCH_MAX_LENGTH, inputSchemaOf } from './discovery-input-schema'
import { failure, fromBackendResult, fromOperationResult, isRecord } from './discovery-results'
import { MAX_SEARCH_QUERY_LENGTH, rank } from './discovery-search'
import { type AgentOperation, annotationsOf } from './operation'
import { proposeOperation } from './operation-proposals'
import { callDecision, findVisibleBackendOperation, findVisibleOperation, nativeToolOf } from './policy'
import type { AgentPrincipal } from './principal'
import { readGateFor, sharedConversationReadRefusal } from './read-gate'
import { type McpCallContext, recordOperationCalled } from './telemetry'

export async function runBackendOperation(
  ctx: McpCallContext,
  op: BackendOperation,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const startedAt = Date.now()
  const record = (status: number) =>
    recordOperationCalled(ctx, { operation: op.name, domain: op.domain, decision: 'run', status, startedAt })
  const projectId = typeof input.projectId === 'string' ? input.projectId : undefined
  try {
    const refused = await readGateFor(ctx.principal).beforeRead(op)
    if (refused) {
      record(403)
      return failure(refused)
    }
    const result = await callBackendOperation(op.name, input, ctx.principal.session, { projectId })
    record(result.status)
    return fromBackendResult(op, result)
  } catch (error) {
    console.error('[mcp] backend operation failed', op.name, error)
    record(500)
    return problemFailure(`${op.name} failed on the server. Try again; if it persists, report it.`, 500, 'INTERNAL_ERROR')
  }
}

export function nativeToolRefusal(name: string, tool: string): string {
  return `${name} is not offered to you: you do this with your own tool ${tool}. Call that instead.`
}

export function unknownOperation(ctx: McpCallContext, name: string): CallToolResult {
  const native = isAgentKind(ctx.principal.actor) ? nativeToolOf(name) : undefined
  if (native) return problemFailure(nativeToolRefusal(name, native), 404, 'UNKNOWN_OPERATION')
  const near = rank(ctx, name.slice(0, MAX_SEARCH_QUERY_LENGTH), undefined)
    .slice(0, 5)
    .map((hit) => hit.name)
  const hint = near.length > 0 ? ` Closest: ${near.join(', ')}.` : ''
  return problemFailure(`Unknown operation "${name}".${hint} Use search-operations to find the right name.`, 404, 'UNKNOWN_OPERATION')
}

export async function readOperationBody(
  ctx: McpCallContext,
  name: string,
  input: OperationInput,
): Promise<{ body: unknown } | { refusal: string }> {
  const op = findVisibleOperation(ctx.principal, name)
  if (!op || !annotationsOf(op).readOnlyHint || callDecision(ctx.principal, op) !== 'run') {
    return { refusal: `${name} is not a read this connection may run.` }
  }
  const startedAt = Date.now()
  const record = (status: number) =>
    recordOperationCalled(ctx, { operation: op.name, domain: op.domain, decision: 'run', status, startedAt })
  try {
    const refused = await readGateFor(ctx.principal).beforeRead(op, input)
    if (refused) {
      record(403)
      return { refusal: refused }
    }
    const result = await callOperation(op, input, ctx.principal.session, 'agent')
    record(result.status)
    if (!result.ok) return { refusal: `${name} was refused (HTTP ${result.status}).` }
    return { body: result.body }
  } catch (error) {
    if (error instanceof OperationInputError) {
      record(400)
      return { refusal: inputRefusal(op, error) }
    }
    if (error instanceof ApiError) {
      record(error.status)
      return { refusal: `${error.message} (HTTP ${error.status}, ${error.code})` }
    }
    console.error('[mcp] operation read failed', op.name, error)
    record(500)
    return { refusal: `${name} failed on the server.` }
  }
}

export async function runOperation(ctx: McpCallContext, name: string, input: OperationInput): Promise<CallToolResult> {
  const startedAt = Date.now()
  const op = findVisibleOperation(ctx.principal, name)
  if (!op) {
    const backend = findVisibleBackendOperation(ctx.principal, name)
    if (backend) return runBackendOperation(ctx, backend, isRecord(input) ? { ...input } : {})
    recordOperationCalled(ctx, { operation: null, domain: null, decision: 'refused', status: 404, startedAt })
    return unknownOperation(ctx, name)
  }
  const decision = callDecision(ctx.principal, op)
  const record = (status: number) =>
    recordOperationCalled(ctx, { operation: op.name, domain: op.domain, decision, status, startedAt })

  if (decision === 'propose') {
    try {
      const parsed = validateOperationInput(op, input)
      const proposal = await proposeOperation({ principal: ctx.principal, op, input: parsed })
      record(202)
      return {
        content: [{ type: 'text', text: 'Proposed — the person decides. Nothing was changed.' }],
        structuredContent: {
          decision: 'propose',
          proposalId: proposal.proposalId,
          summary: proposal.summary,
          operation: op.name,
        },
      }
    } catch (error) {
      return operationFailure(op, error, record)
    }
  }
  const outcome = await executeOperation(ctx, op, input, startedAt)
  return 'refusal' in outcome ? outcome.refusal : fromOperationResult(op, outcome.result, input, undefined, offersAppViews(ctx))
}

export interface OperationRefusal {
  refusal: CallToolResult
  status: number
  code?: string
}

export async function executeOperation(
  ctx: McpCallContext,
  op: AgentOperation,
  input: OperationInput,
  startedAt = Date.now(),
): Promise<{ result: OperationResult } | OperationRefusal> {
  const record = (status: number) =>
    recordOperationCalled(ctx, { operation: op.name, domain: op.domain, decision: 'run', status, startedAt })
  try {
    const gate = readGateFor(ctx.principal)
    const refused = await gate.beforeRead(op, input)
    if (refused) {
      record(403)
      return { refusal: problemFailure(refused, 403, 'FORBIDDEN', READ_GATE_DETAIL), status: 403, code: 'FORBIDDEN' }
    }
    const result = await callOperation(op, input, ctx.principal.session, 'agent', { decisionSource: ctx.decisionSource, clientId: ctx.principal.clientId ?? undefined, ...actingDoorOf(ctx) })
    record(result.status)
    if (isRedirectBody(result.body) && !(await gate.mayHandOnLink())) {
      return { refusal: problemFailure(sharedConversationReadRefusal(), 403, 'FORBIDDEN', READ_GATE_DETAIL), status: 403, code: 'FORBIDDEN' }
    }
    return { result }
  } catch (error) {
    return failureOf(op, error, record)
  }
}

function operationFailure(op: AgentOperation, error: unknown, record: (status: number) => void): CallToolResult {
  return failureOf(op, error, record).refusal
}

function failureOf(op: AgentOperation, error: unknown, record: (status: number) => void): OperationRefusal {
  if (error instanceof OperationInputError) {
    record(400)
    return { refusal: problemFailure(inputRefusal(op, error), 400, 'VALIDATION_ERROR'), status: 400, code: 'VALIDATION_ERROR' }
  }
  if (error instanceof ApiError) {
    record(error.status)
    return { refusal: problemFailure(`${error.message} (HTTP ${error.status}, ${error.code})`, error.status, error.code), status: error.status, code: error.code }
  }
  console.error('[mcp] operation failed', op.name, error)
  record(500)
  return { refusal: problemFailure(`${op.name} failed on the server. Try again; if it persists, report it.`, 500, 'INTERNAL_ERROR'), status: 500 }
}

const INLINE_SCHEMA_CHARS = 2_000

function inputRefusal(op: AgentOperation, error: OperationInputError): string {
  const schema = JSON.stringify(inputSchemaOf(op))
  return schema.length <= INLINE_SCHEMA_CHARS
    ? `${error.message}. The input schema of ${op.name}: ${schema}`
    : `${error.message}. Use describe-operation for ${op.name} to see its input schema.`
}

const callInput = z.object({
  name: z.string().min(1),
  input: z
    .object({
      params: z.record(z.string(), z.string()).optional(),
      query: z.record(z.string(), z.unknown()).optional(),
      body: z.unknown().optional(),
      ifMatch: z.string().min(1).max(IF_MATCH_MAX_LENGTH).optional(),
      idempotencyKey: z.string().min(1).max(255).optional(),
    })
    .optional(),
})

const backendCallInput = z.object({ name: z.string().min(1), input: z.record(z.string(), z.unknown()).optional() })

export function catalogCallOf(principal: AgentPrincipal, args: unknown): { operation: string; input: OperationInput } | null {
  const parsed = callInput.safeParse(args)
  if (!parsed.success || !findVisibleOperation(principal, parsed.data.name)) return null
  return { operation: parsed.data.name, input: parsed.data.input ?? {} }
}

export function callOperationTool(ctx: McpCallContext, args: unknown): Promise<CallToolResult> {
  const backendName = isRecord(args) && typeof args.name === 'string' ? args.name : null
  const backend = backendName ? findVisibleBackendOperation(ctx.principal, backendName) : undefined
  if (backend) {
    const flat = backendCallInput.safeParse(args)
    if (!flat.success) return Promise.resolve(failure(`call-operation needs { name, input } with ${backend.name}'s arguments.`))
    return runBackendOperation(ctx, backend, flat.data.input ?? {})
  }
  if (backendName && !findVisibleOperation(ctx.principal, backendName)) {
    return runOperation(ctx, backendName, {})
  }
  const parsed = callInput.safeParse(args)
  if (!parsed.success) {
    return Promise.resolve(failure('call-operation needs { name, input: { params?, query?, body? } }.'))
  }
  return runOperation(ctx, parsed.data.name, parsed.data.input ?? {})
}
