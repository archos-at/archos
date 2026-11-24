/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FOR_READER_CASES, type MarkPerson } from '@/test-utils/marks-for-reader'
import { isForReader, isLive, isOpenItem, isProposedItem } from './types'

const id = (person: MarkPerson | null) => (person === null ? null : person === 'reader' ? 'user_reader' : 'user_colleague')

describe('isForReader', () => {
  it.each(FOR_READER_CASES)('$name', (mark) => {
    const annotation = {
      status: mark.status,
      shape: mark.shape ?? ('point' as const),
      assigneeUserId: id(mark.assignee),
      createdBy: id(mark.setBy),
    }
    expect(isForReader(annotation, 'user_reader')).toBe(mark.forReader)
    expect(isLive(annotation) && isForReader(annotation, 'user_reader')).toBe(mark.counted)
  })

  it('is nobody’s while the reader is not known', () => {
    expect(isForReader({ status: 'open', shape: 'point', assigneeUserId: null }, null)).toBe(false)
  })

  it('counts a kept measurement neither open nor proposed, though it stays live', () => {
    for (const shape of ['line', 'path', 'polygon'] as const) {
      expect(isLive({ status: 'open' })).toBe(true)
      expect(isOpenItem({ status: 'open', shape })).toBe(false)
      expect(isProposedItem({ status: 'proposed', shape })).toBe(false)
    }
    expect(isOpenItem({ status: 'open', shape: 'region' })).toBe(true)
    expect(isProposedItem({ status: 'proposed', shape: 'point' })).toBe(true)
  })
})
