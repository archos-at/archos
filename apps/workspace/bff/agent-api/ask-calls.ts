import 'server-only'

import {
  type CallToolResult,
  CLIENT_CAPABILITIES_META_KEY,
  type McpServer,
  MissingRequiredClientCapabilityError,
  ProtocolError,
  ProtocolErrorCode,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import { ASK_WAIT_SECONDS, type AskState, type AskView, isTerminalAskState } from '@/lib/agent-asks/ask-wire'
import { executeOperation, fromOperationResult, runOperation } from './discovery'
import { type OperationInput, type OperationResult, OperationInputError, validateOperationInput } from './dispatch'
import type { AgentOperation } from './operation'
import { callDecision, findVisibleOperation } from './policy'
import type { AgentPrincipal } from './principal'
import type { McpCallContext } from './telemetry'
import { PRODUCT_NAME } from '@/lib/brand'

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'

export const ASK_CREATE = 'agent-ask-create'
const ASK_GET = 'agent-ask-get'
const ASK_CANCEL = 'agent-ask-cancel'

export const PROGRESS_STEP_SECONDS = 5

const DEFAULT_POLL_MS = 10_000

function askOperations(principal: AgentPrincipal): Record<'create' | 'get' | 'cancel', AgentOperation> | null {
  const create = findVisibleOperation(principal, ASK_CREATE)
  const get = findVisibleOperation(principal, ASK_GET)
  const cancel = findVisibleOperation(principal, ASK_CANCEL)
  if (!create || !get || !cancel) return null
  if ([create, get, cancel].some((op) => callDecision(principal, op) !== 'run')) return null
  return { create, get, cancel }
}

export const offersAskTasks = (principal: AgentPrincipal): boolean => askOperations(principal) !== null

export function declaresTasks(call: Pick<ServerContext, 'mcpReq'>): boolean {
  const envelope: Record<string, unknown> = { ...call.mcpReq.envelope }
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY]
  const extensions = isRecord(capabilities) ? capabilities.extensions : undefined
  return isRecord(extensions) && isRecord(extensions[TASKS_EXTENSION])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAskView(body: unknown): body is AskView {
  return isRecord(body) && typeof body.id === 'string' && typeof body.state === 'string'
}

type AskRead = { view: AskView; result: OperationResult } | { refusal: CallToolResult; status: number | null }

async function callAsk(ctx: McpCallContext, op: AgentOperation, input: OperationInput): Promise<AskRead> {
  const outcome = await executeOperation(ctx, op, input)
  if ('refusal' in outcome) return { refusal: outcome.refusal, status: null }
  const { result } = outcome
  if (result.ok && isAskView(result.body)) return { view: result.body, result }
  return { refusal: fromOperationResult(op, result), status: result.status }
}

function waitBudget(input: OperationInput): number {
  const body = isRecord(input.body) ? input.body : {}
  return typeof body.waitSeconds === 'number' ? body.waitSeconds : ASK_WAIT_SECONDS
}

const STATUS_TEXT: Readonly<Record<AskState, string>> = {
  submitted: 'The question is recorded; ' + PRODUCT_NAME + ' has not started on it yet.',
  working: PRODUCT_NAME + ' is working on the answer.',
  completed: PRODUCT_NAME + ' answered.',
  canceled: 'The ask was canceled.',
  failed: 'The ask failed.',
  rejected: 'The ask was rejected.',
}

export async function runAskCreate(
  ctx: McpCallContext,
  input: OperationInput,
  call: ServerContext | null,
): Promise<CallToolResult> {
  const ops = askOperations(ctx.principal)
  const token = call?.mcpReq._meta?.progressToken
  const tasks = call !== null && declaresTasks(call)
  const budget = waitBudget(input)
  if (!ops || !call || (!tasks && (token === undefined || budget === 0))) return runOperation(ctx, ASK_CREATE, input)
  try {
    validateOperationInput(ops.create, input)
  } catch (error) {
    if (error instanceof OperationInputError) return runOperation(ctx, ASK_CREATE, input)
    throw error
  }
  const startedAt = Date.now()
  const body = isRecord(input.body) ? input.body : {}
  const first = await callAsk(ctx, ops.create, { ...input, body: { ...body, waitSeconds: 0 } })
  if ('refusal' in first) return first.refusal
  if (isTerminalAskState(first.view.state)) return fromOperationResult(ops.create, first.result)
  if (tasks) return createTaskResult(first.view)
  return waitWithProgress(ctx, ops, first, { call, token: token as string | number, budget, startedAt })
}

async function waitWithProgress(
  ctx: McpCallContext,
  ops: Record<'create' | 'get', AgentOperation>,
  first: { view: AskView; result: OperationResult },
  wait: { call: ServerContext; token: string | number; budget: number; startedAt: number },
): Promise<CallToolResult> {
  let current = first
  let reported = -1
  while (!isTerminalAskState(current.view.state) && !wait.call.mcpReq.signal.aborted) {
    const elapsed = Math.round(Date.now() - wait.startedAt) / 1_000
    const remaining = Math.floor(wait.budget - elapsed)
    if (remaining < 1) break
    if (elapsed > reported) {
      reported = elapsed
      await wait.call.mcpReq.notify({
        method: 'notifications/progress',
        params: { progressToken: wait.token, progress: elapsed, total: wait.budget, message: STATUS_TEXT[current.view.state] },
      })
    }
    const next = await callAsk(ctx, ops.get, {
      params: { id: current.view.id },
      query: { waitSeconds: Math.min(PROGRESS_STEP_SECONDS, remaining) },
    })
    if ('refusal' in next) break
    current = next
  }
  return fromOperationResult(ops.create, current.result)
}

interface TaskFields {
  taskId: string
  status: 'working' | 'completed' | 'cancelled'
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: null
  pollIntervalMs?: number
}

function taskOf(view: AskView): TaskFields {
  const terminal = isTerminalAskState(view.state)
  return {
    taskId: view.id,
    status: view.state === 'canceled' ? 'cancelled' : terminal ? 'completed' : 'working',
    statusMessage: view.reason ?? STATUS_TEXT[view.state],
    createdAt: view.createdAt,
    lastUpdatedAt: view.updatedAt,
    ttlMs: null,
    ...(terminal ? {} : { pollIntervalMs: (view.pollAfterSeconds ?? 0) * 1_000 || DEFAULT_POLL_MS }),
  }
}

function createTaskResult(view: AskView): CallToolResult {
  return { resultType: 'task', ...taskOf(view) } as unknown as CallToolResult
}

const taskParams = z.object({ taskId: z.string().min(1) }).passthrough()

const unknownTask = () => new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown task: no ask of yours has this id.')

function requireDeclared(call: ServerContext): void {
  if (!declaresTasks(call)) {
    throw new MissingRequiredClientCapabilityError({ requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } })
  }
}

async function readTask(ctx: McpCallContext, op: AgentOperation, taskId: string): Promise<{ view: AskView; result: OperationResult }> {
  if (!z.guid().safeParse(taskId).success) throw unknownTask()
  const read = await callAsk(ctx, op, { params: { id: taskId } })
  if ('view' in read) return read
  if (read.status === 404) throw unknownTask()
  throw new ProtocolError(ProtocolErrorCode.InternalError, textOf(read.refusal))
}

const textOf = (result: CallToolResult): string =>
  result.content.map((block) => (block.type === 'text' ? block.text : '')).join(' ').trim() || 'The ask could not be read.'

export function registerAskTasks(server: McpServer, ctx: McpCallContext): void {
  const ops = askOperations(ctx.principal)
  if (!ops) return
  server.server.setRequestHandler('tasks/get', { params: taskParams }, async ({ taskId }, call) => {
    requireDeclared(call)
    const { view, result } = await readTask(ctx, ops.get, taskId)
    const task = taskOf(view)
    return task.status === 'completed' ? { ...task, result: fromOperationResult(ops.create, result) } : { ...task }
  })
  server.server.setRequestHandler('tasks/cancel', { params: taskParams }, async ({ taskId }, call) => {
    requireDeclared(call)
    if (!z.guid().safeParse(taskId).success) throw unknownTask()
    const read = await callAsk(ctx, ops.cancel, { params: { id: taskId } })
    if ('view' in read || read.status === 409) return {}
    if (read.status === 404) throw unknownTask()
    throw new ProtocolError(ProtocolErrorCode.InternalError, textOf(read.refusal))
  })
  server.server.setRequestHandler('tasks/update', { params: taskParams }, async ({ taskId }, call) => {
    requireDeclared(call)
    await readTask(ctx, ops.get, taskId)
    return {}
  })
}
