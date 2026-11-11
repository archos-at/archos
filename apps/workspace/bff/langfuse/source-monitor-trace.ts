import 'server-only'
/**
 * One run of the source monitor as a Langfuse trace (ADR-0089, ADR-0174): the
 * trace `source-monitor` with one `freshness-lag-days` score per watched
 * source, its comment the source's record id. Everything the product does is
 * observable in Langfuse, and a monitor that went quiet is what the score
 * shows: a source it cannot reach grows a day a day.
 *
 * Names and numbers only: no page, no URL query, no key. Posted through the
 * ingestion API and never awaited by the sweep's outcome; with Langfuse
 * unconfigured nothing is sent.
 */

import { langfuseApiConfig } from './config'
import { clientFor, environment, release } from './tool-call-trace'

export const SOURCE_MONITOR_TRACE_NAME = 'source-monitor'
/** Declared in `packages/agent/src/agent/observability/onboarding_scores.py`. */
export const FRESHNESS_SCORE_NAME = 'freshness-lag-days'

export interface SourceMonitorRun {
  startedAt: number
  endedAt: number
  checked: number
  changed: number
  failed: number
  opened: number
  /** Per watched source: its record id and days since its last successful check. */
  lags: { recordId: string; days: number }[]
}

type Client = ReturnType<typeof clientFor>
type IngestionBatch = Parameters<Client['api']['ingestion']['batch']>[0]

/** The ingestion batch for one run. Pure, so the mapping is tested without a network. */
export function sourceMonitorBatch(run: SourceMonitorRun, ids: { traceId: string; eventId: () => string }): IngestionBatch {
  const env = environment()
  const rel = release()
  const timestamp = new Date(run.startedAt).toISOString()
  return {
    batch: [
      {
        type: 'trace-create',
        id: ids.eventId(),
        timestamp,
        body: {
          id: ids.traceId,
          timestamp,
          name: SOURCE_MONITOR_TRACE_NAME,
          metadata: {
            checked: run.checked,
            changed: run.changed,
            failed: run.failed,
            opened: run.opened,
            duration_ms: run.endedAt - run.startedAt,
          },
          tags: ['feature:source-monitor', ...(run.failed > 0 ? ['error:source'] : [])],
          ...(env ? { environment: env } : {}),
          ...(rel ? { release: rel } : {}),
        },
      },
      ...run.lags.map((lag) => ({
        type: 'score-create' as const,
        id: ids.eventId(),
        timestamp,
        body: {
          id: ids.eventId(),
          traceId: ids.traceId,
          name: FRESHNESS_SCORE_NAME,
          value: lag.days,
          dataType: 'NUMERIC' as const,
          comment: lag.recordId,
          ...(env ? { environment: env } : {}),
        },
      })),
    ],
  }
}

const hexId = () => crypto.randomUUID().replace(/-/g, '')

/** Post the run's trace and scores. Resolves when sent (or skipped) and never rejects. */
export async function recordSourceMonitorRun(run: SourceMonitorRun): Promise<void> {
  const config = langfuseApiConfig()
  if (!config) return
  try {
    const batch = sourceMonitorBatch(run, { traceId: hexId(), eventId: () => crypto.randomUUID() })
    await clientFor(config).api.ingestion.batch(batch, { timeoutInSeconds: 5, maxRetries: 1 })
  } catch (error) {
    console.warn('[Langfuse] source monitor trace failed (non-fatal):', error)
  }
}
