import 'server-only'
import type {
  AgentCard,
  CancelTaskRequest,
  GetExtendedAgentCardRequest,
  GetTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  ListTaskPushNotificationConfigsResponse,
  Message,
  SendMessageRequest,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '@a2a-js/sdk'
import {
  ExtendedAgentCardNotConfiguredError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '@a2a-js/sdk/errors'
import type { A2ARequestHandler } from '@a2a-js/sdk/server'
import { findOperation } from '@/lib/agent-api/catalog'
import { isExposedTo } from '@/lib/agent-api/exposure'
import { callOperation, type OperationInput, type OperationResult } from '@/lib/agent-api/dispatch'
import type { AgentPrincipal } from '@/lib/agent-api/principal'
import type { ActingOrigin } from '@/lib/agent-api/acting-session'
import { actingDoorOf } from '@/lib/agent-api/call-origin'
import { recordOperationCalled } from '@/lib/agent-api/telemetry'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ASK_WAIT_SECONDS, isTerminalAskState, type AskView } from '@/lib/agent-asks/ask-wire'
import { askInputOf, artifactsOf, taskOf } from './task-mapping'
import { PRODUCT_NAME } from '@/lib/brand'

export const BLOCKING_MAX_MS = 5 * 60_000
export const STREAM_MAX_MS = 15 * 60_000
const STREAM_POLL_SECONDS = 10

export type AskCaller = (
  name: string,
  input: OperationInput,
  session: AuthorizedSession,
  origin?: ActingOrigin,
) => Promise<OperationResult>

export const callAskOperation: AskCaller = (name, input, session, origin = {}) => {
  const op = findOperation(name)
  if (!op) throw new Error(`the operation ${name} is not in the catalog`)
  if (!isExposedTo('external', op.name)) throw new Error(`the operation ${name} is not offered to an outside agent`)
  return callOperation(op, input, session, 'agent', origin)
}

function routeMessage(result: OperationResult): string {
  const body = result.body
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === 'string' && error.trim()) return error
  }
  return `${PRODUCT_NAME} refused the request (${result.status}).`
}

function refusal(result: OperationResult, notFound: 'task' | 'malformed'): Error {
  const message = routeMessage(result)
  if (result.status === 404) return notFound === 'task' ? new TaskNotFoundError(message) : new RequestMalformedError(message)
  if (result.status === 400 || result.status === 422) return new RequestMalformedError(message)
  return new Error(message)
}

function viewOf(result: OperationResult, notFound: 'task' | 'malformed'): AskView {
  if (!result.ok) throw refusal(result, notFound)
  return result.body as AskView
}

const statusUpdate = (view: AskView): StreamResponse => {
  const task = taskOf(view)
  return {
    payload: {
      $case: 'statusUpdate',
      value: { taskId: task.id, contextId: task.contextId, status: task.status, metadata: undefined },
    },
  }
}

function* artifactUpdates(view: AskView): Generator<StreamResponse> {
  for (const artifact of artifactsOf(view)) {
    yield {
      payload: {
        $case: 'artifactUpdate',
        value: { taskId: view.id, contextId: view.conversationId, artifact, append: false, lastChunk: true, metadata: undefined },
      },
    }
  }
}

export class AgentA2ARequestHandler implements A2ARequestHandler {
  private readonly session: AuthorizedSession
  private readonly origin: ActingOrigin

  constructor(
    private readonly principal: AgentPrincipal,
    private readonly card: AgentCard,
    private readonly call: AskCaller = callAskOperation,
  ) {
    this.session = principal.session
    this.origin = { clientId: principal.clientId ?? undefined, ...actingDoorOf({ principal, door: 'a2a' }) }
  }

  private async run(name: string, input: OperationInput, recorded = true): Promise<OperationResult> {
    if (!recorded) return this.call(name, input, this.session, this.origin)
    const startedAt = Date.now()
    const record = (status: number) =>
      recordOperationCalled(
        { principal: this.principal, mode: null, door: 'a2a' },
        { operation: name, domain: 'conversations', decision: 'run', status, startedAt },
      )
    try {
      const result = await this.call(name, input, this.session, this.origin)
      record(result.status)
      return result
    } catch (error) {
      record(500)
      throw error
    }
  }

  async getAgentCard(): Promise<AgentCard> {
    return this.card
  }

  async getAuthenticatedExtendedAgentCard(_params: GetExtendedAgentCardRequest): Promise<AgentCard> {
    throw new ExtendedAgentCardNotConfiguredError(PRODUCT_NAME + ' has one agent card, the public one.')
  }

  private async ask(params: SendMessageRequest, waitSeconds?: number): Promise<AskView> {
    const input = askInputOf(params.message, params.metadata)
    const body = waitSeconds === undefined ? input : { ...input, waitSeconds }
    const result = await this.run('agent-ask-create', { body })
    if (result.status === 404 && body.conversationId) {
      const { conversationId: _unknown, ...fresh } = body
      return viewOf(await this.run('agent-ask-create', { body: fresh }), 'malformed')
    }
    return viewOf(result, 'malformed')
  }

  private async read(id: string, waitSeconds: number, recorded = true): Promise<AskView> {
    const query = waitSeconds > 0 ? { waitSeconds } : {}
    return viewOf(await this.run('agent-ask-get', { params: { id }, query }, recorded), 'task')
  }

  private async settle(view: AskView, deadline: number): Promise<AskView> {
    let current = view
    while (!isTerminalAskState(current.state) && Date.now() < deadline) {
      const left = Math.ceil((deadline - Date.now()) / 1_000)
      current = await this.read(current.id, Math.max(1, Math.min(ASK_WAIT_SECONDS, left)), false)
    }
    return current
  }

  async sendMessage(params: SendMessageRequest): Promise<Message | Task> {
    const started = Date.now()
    const immediately = params.configuration?.returnImmediately === true
    const view = await this.ask(params, immediately ? 0 : undefined)
    const historyLength = params.configuration?.historyLength
    if (immediately) return taskOf(view, historyLength)
    return taskOf(await this.settle(view, started + BLOCKING_MAX_MS), historyLength)
  }

  private async *follow(first: AskView): AsyncGenerator<StreamResponse, void, undefined> {
    const deadline = Date.now() + STREAM_MAX_MS
    let view = first
    let lastState = view.state
    while (!isTerminalAskState(view.state) && Date.now() < deadline) {
      view = await this.read(view.id, STREAM_POLL_SECONDS, false)
      if (view.state !== lastState && !isTerminalAskState(view.state)) yield statusUpdate(view)
      lastState = view.state
    }
    if (!isTerminalAskState(view.state)) return
    yield* artifactUpdates(view)
    yield statusUpdate(view)
  }

  async *sendMessageStream(params: SendMessageRequest): AsyncGenerator<StreamResponse, void, undefined> {
    const view = await this.ask(params, 0)
    if (isTerminalAskState(view.state)) {
      yield { payload: { $case: 'task', value: taskOf(view) } }
      return
    }
    yield { payload: { $case: 'task', value: taskOf(view) } }
    yield* this.follow(view)
  }

  async getTask(params: GetTaskRequest): Promise<Task> {
    return taskOf(await this.read(params.id, 0), params.historyLength)
  }

  async cancelTask(params: CancelTaskRequest): Promise<Task> {
    const result = await this.run('agent-ask-cancel', { params: { id: params.id } })
    if (result.status === 409) throw new TaskNotCancelableError(routeMessage(result))
    return taskOf(viewOf(result, 'task'))
  }

  async *resubscribe(params: SubscribeToTaskRequest): AsyncGenerator<StreamResponse, void, undefined> {
    const view = await this.read(params.id, 0)
    if (isTerminalAskState(view.state)) {
      throw new UnsupportedOperationError('The task has ended; read it with GetTask.')
    }
    yield { payload: { $case: 'task', value: taskOf(view) } }
    yield* this.follow(view)
  }

  async listTasks(_params: ListTasksRequest): Promise<ListTasksResponse> {
    throw new UnsupportedOperationError(PRODUCT_NAME + ' does not list tasks. Read one with GetTask.')
  }

  async createTaskPushNotificationConfig(): Promise<TaskPushNotificationConfig> {
    throw new PushNotificationNotSupportedError(PRODUCT_NAME + ' sends no push notifications; stream or poll instead.')
  }

  async getTaskPushNotificationConfig(): Promise<TaskPushNotificationConfig> {
    throw new PushNotificationNotSupportedError(PRODUCT_NAME + ' sends no push notifications; stream or poll instead.')
  }

  async listTaskPushNotificationConfigs(): Promise<ListTaskPushNotificationConfigsResponse> {
    throw new PushNotificationNotSupportedError(PRODUCT_NAME + ' sends no push notifications; stream or poll instead.')
  }

  async deleteTaskPushNotificationConfig(): Promise<void> {
    throw new PushNotificationNotSupportedError(PRODUCT_NAME + ' sends no push notifications; stream or poll instead.')
  }
}
