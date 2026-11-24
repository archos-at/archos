/**
 * @vitest-environment node
 *
 * One source-monitor run as a Langfuse trace (ADR-0174): the trace carries the
 * run's counts, and each watched source a `freshness-lag-days` score, with
 * names and numbers only.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { FRESHNESS_SCORE_NAME, SOURCE_MONITOR_TRACE_NAME, sourceMonitorBatch } = await import('./source-monitor-trace')

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sourceMonitorBatch', () => {
  it('tags the run with the deployment’s host and stack', () => {
    vi.stubEnv('WORKOS_REDIRECT_URI', 'https://app.example.test/api/auth/callback')
    vi.stubEnv('POSTHOG_DEPLOYMENT', 'prod')
    const run = { startedAt: 0, endedAt: 1, checked: 0, changed: 0, failed: 0, opened: 0, lags: [] }
    const [trace] = sourceMonitorBatch(run, { traceId: 'a'.repeat(32), eventId: () => 'event-1' }).batch
    expect(trace?.body).toMatchObject({
      tags: ['feature:source-monitor', 'app_host:app.example.test', 'deployment:prod'],
    })
  })

  it('posts the run as a trace and one freshness score per watched source', () => {
    let n = 0
    const batch = sourceMonitorBatch(
      {
        startedAt: Date.parse('2026-11-10T10:00:00Z'),
        endedAt: Date.parse('2026-11-10T10:00:02Z'),
        checked: 2,
        changed: 1,
        failed: 1,
        opened: 1,
        lags: [
          { recordId: 'source:xa-gazette', days: 0 },
          { recordId: 'source:xa-zoning', days: 3 },
        ],
      },
      { traceId: 'a'.repeat(32), eventId: () => `event-${(n += 1)}` },
    )
    const [trace, ...scores] = batch.batch
    expect(trace).toMatchObject({
      type: 'trace-create',
      body: { name: SOURCE_MONITOR_TRACE_NAME, metadata: { checked: 2, changed: 1, failed: 1, opened: 1, duration_ms: 2000 }, tags: ['feature:source-monitor', 'error:source'] },
    })
    expect(scores.map((score) => score.body)).toEqual([
      expect.objectContaining({ traceId: 'a'.repeat(32), name: FRESHNESS_SCORE_NAME, value: 0, dataType: 'NUMERIC', comment: 'source:xa-gazette' }),
      expect.objectContaining({ name: 'freshness-lag-days', value: 3, comment: 'source:xa-zoning' }),
    ])
  })
})
