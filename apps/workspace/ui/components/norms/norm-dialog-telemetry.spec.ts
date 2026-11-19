import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

import { capturePosthog } from '@/lib/analytics/posthog'
import { countsOfResults, countsOfRows, normDialogSettled } from './norm-dialog-telemetry'

describe('the norm dialog’s counts', () => {
  it('counts each settled row by its outcome, a missing edition as later and a failure as nothing', () => {
    const outcomes = ['confirmed', 'confirmed', 'not_norm', 'edition_added', 'duplicate_removed', 'edition_missing', 'failed'] as const
    expect(countsOfResults(outcomes.map((outcome, index) => ({ entryId: `e${index}`, outcome, error: null })))).toEqual({
      confirmed: 2,
      not_norm: 1,
      later: 1,
      edition_added: 1,
      duplicate_removed: 1,
    })
  })

  it('counts the rows a destination took as confirmed or not a norm', () => {
    expect(countsOfRows([{ entryId: 'a' }, { entryId: 'b', notNorm: true }, { entryId: 'c' }])).toEqual({ confirmed: 2, not_norm: 1 })
  })

  it('sends every count, zero for those the settle did not touch', () => {
    normDialogSettled('review_pending', { later: 3 })
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_settled', {
      confirmed: 0,
      not_norm: 0,
      later: 3,
      edition_added: 0,
      duplicate_removed: 0,
      source: 'review_pending',
    })
  })
})
