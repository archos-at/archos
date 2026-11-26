import { describe, expect, it } from 'vitest'


import { SYSTEM_READERS } from '@/lib/db/tenant-context'
import { JOB_HANDLERS } from './handlers'
import { SYSTEM_READER_JOBS } from './run'

describe('the jobs that read for no person name their system reader (ADR-0193)', () => {
  it('lists only jobs that exist, each with a registered reader', () => {
    for (const [kind, reader] of Object.entries(SYSTEM_READER_JOBS)) {
      expect(JOB_HANDLERS).toHaveProperty(kind)
      expect(SYSTEM_READERS).toHaveProperty(reader as string)
    }
  })
})
