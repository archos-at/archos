import 'server-only'

import {
  CLIENT_CAPABILITIES_META_KEY,
  ProtocolError,
  ProtocolErrorCode,
  SUBSCRIPTION_ID_META_KEY,
  TRACEPARENT_META_KEY,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import { ASK_WAIT_SECONDS, isTerminalAskState, type AskView } from '@/lib/agent-asks/ask-wire'
import { TASKS_EXTENSION, askOperationsFor, detailedTaskOf, readTask, type AskOperations } from '../ask-calls'
import type { AgentPrincipal } from '../principal'
import type { McpCallContext, McpMode } from '../telemetry'

export const MAX_LISTENED_TASKS = 20

export const TASK_LISTEN_KEEP_ALIVE_MS = 15_000

const listenSchema = z.object({
  id: z.union([z.string(), z.number()]),
  params: z.object({
    notifications: z.object({ taskIds: z.array(z.string()).max(MAX_LISTENED_TASKS) }).passthrough(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

type ListenMessage = z.infer<typeof listenSchema>

export function asksForTasks(body: unknown): boolean {
  const notifications = (body as { params?: { notifications?: { taskIds?: unknown } } } | null)?.params?.notifications
  return Array.isArray(notifications?.taskIds)
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { status: 200 })
}

function declaresTasks(meta: Record<string, unknown> | undefined): boolean {
  const capabilities = meta?.[CLIENT_CAPABILITIES_META_KEY] as { extensions?: Record<string, unknown> } | undefined
  return typeof capabilities?.extensions === 'object' && capabilities.extensions !== null && TASKS_EXTENSION in capabilities.extensions
}

interface Listener {
  ctx: McpCallContext
  ops: AskOperations
}

async function readable(listener: Listener, taskId: string, waitSeconds: number): Promise<{ view: AskView; task: object } | null> {
  try {
    const read = await readTask(listener.ctx, listener.ops.get, taskId, waitSeconds)
    return { view: read.view, task: detailedTaskOf(listener.ops, read) }
  } catch (error) {
    if (error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams) return null
    throw error
  }
}

export async function serveTaskListen(
  body: unknown,
  door: { principal: AgentPrincipal; mode: McpMode },
  signal: AbortSignal,
  onerror: (error: Error) => void,
): Promise<Response> {
  const parsed = listenSchema.safeParse(body)
  const id = (body as { id?: string | number } | null)?.id ?? null
  if (!parsed.success) return jsonRpcError(id, ProtocolErrorCode.InvalidParams, `Invalid params: taskIds takes at most ${MAX_LISTENED_TASKS} task ids.`)
  const message: ListenMessage = parsed.data
  const meta = message.params._meta
  if (!declaresTasks(meta)) {
    return jsonRpcError(message.id, ProtocolErrorCode.MissingRequiredClientCapability, `Listening to tasks needs the ${TASKS_EXTENSION} extension.`, {
      requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } },
    })
  }
  const ops = askOperationsFor(door.principal)
  const traceparent = meta?.[TRACEPARENT_META_KEY]
  const listener: Listener | null = ops
    ? {
        ops,
        ctx: {
          principal: door.principal,
          mode: door.mode,
          via: 'subscriptions/listen',
          protocol: { era: 'modern', tasks: true, ...(typeof traceparent === 'string' ? { traceparent } : {}) },
        },
      }
    : null

  const asked = [...new Set(message.params.notifications.taskIds)]
  const first = new Map<string, { view: AskView; task: object }>()
  if (listener) {
    for (const taskId of asked) {
      const read = await readable(listener, taskId, 0)
      if (read) first.set(taskId, read)
    }
  }
  return streamTasks(message.id, listener, first, signal, onerror)
}

function streamTasks(
  subscriptionId: string | number,
  listener: Listener | null,
  first: Map<string, { view: AskView; task: object }>,
  signal: AbortSignal,
  onerror: (error: Error) => void,
): Response {
  const encoder = new TextEncoder()
  const stamp = { [SUBSCRIPTION_ID_META_KEY]: subscriptionId }
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  let keepAlive: ReturnType<typeof setInterval> | undefined
  const write = (frame: string) => {
    if (closed) return
    try {
      controller.enqueue(encoder.encode(frame))
    } catch (error) {
      onerror(error instanceof Error ? error : new Error(String(error)))
    }
  }
  const send = (payload: object) => write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n\n`)
  const notify = (task: object) => send({ method: 'notifications/tasks', params: { ...task, _meta: stamp } })
  const close = (graceful: boolean) => {
    if (closed) return
    if (graceful) send({ id: subscriptionId, result: { resultType: 'complete', _meta: stamp } })
    closed = true
    if (keepAlive !== undefined) clearInterval(keepAlive)
    signal.removeEventListener('abort', onAbort)
    try {
      controller.close()
    } catch {
      // already closed by the reader
    }
  }
  const onAbort = () => close(false)

  async function follow(taskId: string, start: { view: AskView }): Promise<void> {
    let last = start.view
    while (!closed && !isTerminalAskState(last.state)) {
      const next = await readable(listener!, taskId, ASK_WAIT_SECONDS)
      if (!next || closed) return
      if (next.view.state !== last.state || next.view.updatedAt !== last.updatedAt) notify(next.task)
      last = next.view
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      if (closed) {
        streamController.close()
        return
      }
      send({ method: 'notifications/subscriptions/acknowledged', params: { notifications: { taskIds: [...first.keys()] }, _meta: stamp } })
      if (first.size === 0 || !listener) {
        close(true)
        return
      }
      for (const read of first.values()) notify(read.task)
      keepAlive = setInterval(() => write(': keepalive\n\n'), TASK_LISTEN_KEEP_ALIVE_MS)
      const followed = [...first.entries()].map(([taskId, read]) => follow(taskId, read))
      void Promise.allSettled(followed).then((outcomes) => {
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') onerror(outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)))
        }
        close(!signal.aborted)
      })
    },
    cancel() {
      close(false)
    },
  })
  if (signal.aborted) close(false)
  else signal.addEventListener('abort', onAbort, { once: true })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
