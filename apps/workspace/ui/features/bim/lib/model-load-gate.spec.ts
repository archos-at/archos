import { describe, expect, it } from 'vitest'
import { AUTOLOAD_MAX_BYTES, AUTOLOAD_MAX_ELEMENTS, loadsOnSight } from './model-load-gate'
import type { BimModelSummary } from '@/lib/bim/types'

const model = (fileSizeBytes: number | null, elementCount: number) => ({
  elementCount,
  summary: fileSizeBytes === null ? null : ({ fileSizeBytes } as BimModelSummary),
})

describe('loadsOnSight', () => {
  it('opens a small model as soon as the card appears', () => {
    expect(loadsOnSight(model(4_000_000, 2_000))).toBe(true)
  })

  it('waits for a press when the file is larger than the limit', () => {
    expect(loadsOnSight(model(AUTOLOAD_MAX_BYTES + 1, 100))).toBe(false)
  })

  it('waits for a press when the model has more elements than the limit', () => {
    expect(loadsOnSight(model(1_000_000, AUTOLOAD_MAX_ELEMENTS + 1))).toBe(false)
  })

  it('decides on the element count alone when the size is unknown', () => {
    expect(loadsOnSight(model(null, 10))).toBe(true)
    expect(loadsOnSight(model(null, AUTOLOAD_MAX_ELEMENTS + 1))).toBe(false)
  })
})
