import 'server-only'

import { LangfuseClient } from '@langfuse/client'
import { type LangfuseApiConfig, langfuseApiConfig } from './config'

export const TOOL_CALL_TRACE_NAME = 'agent-tool-call'

export interface ToolCallRecord {
  operation: string | null
  domain: string | null
  door: 'mcp' | 'piloti' | 'a2a' | 'platform'
  mode: 'search' | 'tools' | null
  decision: 'run' | 'propose' | 'refused' | 'confirm' | 'declined' | 'person_required'
  decisionSource?: 'elicitation' | 'app' | 'app-unverified' | null
  status: number
  startedAt: number
  endedAt: number
  clientId: string | null
  organizationId: string
  userId: string
  conversationId?: string | null
}

type IngestionBatch = Parameters<LangfuseClient['api']['ingestion']['batch']>[0]

export function environment(raw = process.env.APP_ENV ?? ''): string | undefined {
  const value = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return value && !value.startsWith('langfuse') ? value : undefined
}

export function release(raw = process.env.GIT_SHA ?? ''): string | undefined {
  const value = raw.trim()
  return value && value !== 'unknown' ? value : undefined
}

const identityOn = () => process.env.TRACE_IDENTITY_ATTRIBUTES?.trim().toLowerCase() === 'true'

export function toolCallBatch(call: ToolCallRecord, ids: { traceId: string; observationId: string; eventIds: [string, string] }): IngestionBatch {
  const env = environment()
  const rel = release()
  const name = `${call.door === 'a2a' ? 'a2a' : 'mcp'}.${call.operation ?? 'unknown'}`
  const startTime = new Date(call.startedAt).toISOString()
  const endTime = new Date(call.endedAt).toISOString()
  const metadata = {
    operation: call.operation ?? 'unknown',
    domain: call.domain,
    door: call.door,
    mode: call.mode,
    decision: call.decision,
    ...(call.decisionSource ? { decision_source: call.decisionSource } : {}),
    status: call.status,
    duration_ms: call.endedAt - call.startedAt,
    client_id: call.clientId,
  }
  const identity = identityOn()
  return {
    batch: [
      {
        type: 'trace-create',
        id: ids.eventIds[0],
        timestamp: startTime,
        body: {
          id: ids.traceId,
          timestamp: startTime,
          name: TOOL_CALL_TRACE_NAME,
          metadata,
          tags: [
            'feature:agent-mcp',
            `door:${call.door}`,
            `decision:${call.decision}`,
            ...(call.status >= 400 ? [`error:${call.status}`] : []),
            ...(identity ? [`org:${call.organizationId}`] : []),
          ],
          ...(call.conversationId ? { sessionId: call.conversationId } : {}),
          ...(identity ? { userId: call.userId } : {}),
          ...(env ? { environment: env } : {}),
          ...(rel ? { release: rel } : {}),
        },
      },
      {
        type: 'observation-create',
        id: ids.eventIds[1],
        timestamp: startTime,
        body: {
          id: ids.observationId,
          traceId: ids.traceId,
          type: 'TOOL',
          name,
          startTime,
          endTime,
          metadata,
          level: call.status >= 500 ? 'ERROR' : call.status >= 400 ? 'WARNING' : 'DEFAULT',
          ...(call.status >= 400 ? { statusMessage: `HTTP ${call.status}` } : {}),
          ...(env ? { environment: env } : {}),
        },
      },
    ],
  }
}

let cached: { key: string; client: LangfuseClient } | null = null

export function clientFor(config: LangfuseApiConfig): LangfuseClient {
  const key = `${config.baseUrl}\u0000${config.publicKey}\u0000${config.secretKey}`
  if (cached?.key !== key) {
    cached = {
      key,
      client: new LangfuseClient({ publicKey: config.publicKey, secretKey: config.secretKey, baseUrl: config.baseUrl, timeout: 5 }),
    }
  }
  return cached.client
}

const hexId = () => crypto.randomUUID().replace(/-/g, '')

export async function recordToolCallTrace(call: ToolCallRecord): Promise<void> {
  const config = langfuseApiConfig()
  if (!config) return
  try {
    const batch = toolCallBatch(call, {
      traceId: hexId(),
      observationId: crypto.randomUUID(),
      eventIds: [crypto.randomUUID(), crypto.randomUUID()],
    })
    await clientFor(config).api.ingestion.batch(batch, { timeoutInSeconds: 5, maxRetries: 1 })
  } catch (error) {
    console.warn('[Langfuse] tool call trace failed (non-fatal):', error)
  }
}
