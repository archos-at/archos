import 'server-only'

import { captureServer } from '@/lib/analytics/posthog-server'
import { recordToolCallTrace } from '@/lib/langfuse/tool-call-trace'
import { type CallDoor, callDoorOf, sessionSourceOf } from './call-origin'
import type { Confirmation } from './confirmation'
import type { CallDecision } from './policy'
import type { AgentPrincipal } from './principal'

export type McpMode = 'search' | 'tools'

export type { CallDoor, SessionSource } from './call-origin'
export { sessionSourceOf }

export interface McpCallContext {
  principal: AgentPrincipal
  mode: McpMode | null
  door?: CallDoor
  confirmation?: Confirmation | null
  decisionSource?: DecisionSource
  appHost?: 'declared' | 'unknown'
  protocol?: McpProtocol
  via?: CallVia
  askPath?: AskPath
}

export interface McpProtocol {
  era: 'modern' | 'legacy'
  tasks: boolean
  traceparent?: string
}

export type CallVia = 'tool' | 'tasks/get' | 'tasks/cancel' | 'tasks/update' | 'subscriptions/listen'

export type AskPath = 'task' | 'progress' | 'wait'

function protocolProperties(ctx: McpCallContext): Record<string, string | boolean | null> {
  if (!ctx.protocol) return {}
  return {
    protocol_era: ctx.protocol.era,
    client_tasks: ctx.protocol.tasks,
    via: ctx.via ?? 'tool',
    trace_linked: ctx.protocol.traceparent !== undefined,
    ...(ctx.askPath ? { ask_path: ctx.askPath } : {}),
  }
}

export type DecisionSource = 'elicitation' | 'app' | 'app-unverified'

export type RecordedDecision = CallDecision | 'refused' | 'confirm' | 'declined' | 'person_required'

export function recordOperationCalled(
  ctx: McpCallContext,
  call: {
    operation: string | null
    domain: string | null
    decision: RecordedDecision
    status: number
    startedAt: number
  },
): void {
  const { principal, mode } = ctx
  const endedAt = Date.now()
  void recordToolCallTrace({
    operation: call.operation,
    domain: call.domain,
    door: callDoorOf(ctx),
    mode,
    decision: call.decision,
    ...(ctx.decisionSource ? { decisionSource: ctx.decisionSource } : {}),
    status: call.status,
    startedAt: call.startedAt,
    endedAt,
    clientId: principal.clientId,
    organizationId: principal.session.organizationId,
    userId: principal.session.userId,
    conversationId: principal.conversationId ?? null,
    protocol: protocolProperties(ctx),
    ...(ctx.protocol?.traceparent ? { traceparent: ctx.protocol.traceparent } : {}),
  })
  captureServer({
    event: 'agent_operation_called',
    distinctId: principal.session.userId,
    organizationId: principal.session.organizationId,
    properties: {
      operation: call.operation,
      domain: call.domain,
      door: callDoorOf(ctx),
      session_source: sessionSourceOf(ctx),
      mode,
      decision: call.decision,
      ...(ctx.decisionSource ? { decision_source: ctx.decisionSource } : {}),
      status: call.status,
      duration_ms: endedAt - call.startedAt,
      client_id: principal.clientId,
      ...protocolProperties(ctx),
    },
  })
}

export function recordOperationMissing(ctx: McpCallContext, description: string, category: string): void {
  const { principal, mode } = ctx
  captureServer({
    event: 'agent_operation_missing',
    distinctId: principal.session.userId,
    organizationId: principal.session.organizationId,
    properties: {
      description_length: description.length,
      category,
      door: callDoorOf(ctx),
      session_source: sessionSourceOf(ctx),
      mode,
      client_id: principal.clientId,
    },
  })
}
