/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractIngestJobId } from './lost-job'

describe('extractIngestJobId', () => {
  it('extracts a job id from metadata', () => {
    expect(extractIngestJobId({ ingestJobId: 'job-9' })).toBe('job-9')
  })

  it('returns null for missing or malformed metadata', () => {
    expect(extractIngestJobId(null)).toBeNull()
    expect(extractIngestJobId(undefined)).toBeNull()
    expect(extractIngestJobId({})).toBeNull()
    expect(extractIngestJobId({ ingestJobId: 42 })).toBeNull()
    expect(extractIngestJobId('job-9')).toBeNull()
  })
})
