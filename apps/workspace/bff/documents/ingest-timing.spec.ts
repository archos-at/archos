/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { timingOf } from './ingest-timing'

describe('timingOf', () => {
  it('splits queueing from work on the job’s own clock', () => {
    expect(
      timingOf({ submitted_at: '2026-11-02T12:00:00Z', started_at: '2026-11-02T12:00:30Z', completed_at: '2026-11-02T12:02:00Z' })
    ).toEqual({ queueWaitMs: 30_000, processingMs: 90_000, stageSeconds: {}, reading: {} })
  })

  it('reads a naive backend time as UTC, and honours an explicit offset', () => {
    // What `datetime.utcnow()` serializes to: no offset, microseconds.
    expect(timingOf({ started_at: '2026-11-03T10:00:00.250000', completed_at: '2026-11-03T10:01:30.250000' }).processingMs).toBe(90_000)
    expect(timingOf({ started_at: '2026-11-03T10:00:00Z', completed_at: '2026-11-03T11:00:05+01:00' }).processingMs).toBe(5_000)
  })

  it('answers null for a missing, unreadable or out-of-order end, never a wrong number', () => {
    expect(timingOf({ started_at: null, completed_at: '2026-11-03T10:01:30' }).processingMs).toBeNull()
    expect(timingOf({ started_at: '2026-11-03T10:05:00', completed_at: '2026-11-03T10:01:30' }).processingMs).toBeNull()
    expect(timingOf({ started_at: 'not a time', completed_at: 12 }).processingMs).toBeNull()
    expect(timingOf({}).queueWaitMs).toBeNull()
  })

  it('reads where the worked time went and how much was read from the job’s metadata', () => {
    const timing = timingOf({
      metadata: {
        stage_seconds: { text: 1.2, vision: 25.4, dossier: 3, unknown_stage: 9, write: -1 },
        coverage: { pages: 40, pages_fully_read: 38, pages_not_read: 2, pages_over_render_cap: 0, rasters_over_cap: 7, extra: 1 },
        queue_ahead: 3,
      },
    })
    // Only the stages the worker names, only numbers that can be seconds.
    expect(timing.stageSeconds).toEqual({ text: 1.2, vision: 25.4, dossier: 3 })
    expect(timing.reading).toEqual({ pages: 40, pagesFullyRead: 38, pagesNotRead: 2, pagesOverRenderCap: 0, rastersOverCap: 7 })
  })

  it('reads nothing from metadata that is missing or not an object', () => {
    for (const metadata of [undefined, null, 'x', [1], { stage_seconds: 'x', coverage: [2] }]) {
      expect(timingOf({ metadata })).toMatchObject({ stageSeconds: {}, reading: {} })
    }
  })
})
