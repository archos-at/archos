/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FOR_READER_CASES, type MarkPerson } from '@/test-utils/marks-for-reader'
import { isForReader, isLive } from './types'

const id = (person: MarkPerson | null) => (person === null ? null : person === 'reader' ? 'user_reader' : 'user_colleague')

describe('isForReader', () => {
  it.each(FOR_READER_CASES)('$name', (mark) => {
    const annotation = { status: mark.status, assigneeUserId: id(mark.assignee), createdBy: id(mark.setBy) }
    expect(isForReader(annotation, 'user_reader')).toBe(mark.forReader)
    expect(isLive(annotation) && isForReader(annotation, 'user_reader')).toBe(mark.counted)
  })

  it('is nobody’s while the reader is not known', () => {
    expect(isForReader({ status: 'open', assigneeUserId: null }, null)).toBe(false)
  })
})
