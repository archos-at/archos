/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { isTaskThread, taskThreadConversationId } from './task-thread'

const DEFINITION = '3f8b0d2e-0000-4000-8000-000000000001'

describe('taskThreadConversationId', () => {
  it('is the same id for the same definition, every time', () => {
    expect(taskThreadConversationId(DEFINITION)).toBe(taskThreadConversationId(DEFINITION))
  })

  it('is a different id for a different definition', () => {
    expect(taskThreadConversationId(DEFINITION)).not.toBe(
      taskThreadConversationId('3f8b0d2e-0000-4000-8000-000000000002'),
    )
  })

  it('is spelled like every other conversation id', () => {
    expect(taskThreadConversationId(DEFINITION)).toMatch(/^s_[0-9a-f_]{36}$/)
  })
})

describe('isTaskThread', () => {
  it('recognises a standing thread from the row alone, with no query', () => {
    expect(isTaskThread({ id: taskThreadConversationId(DEFINITION), jobId: DEFINITION })).toBe(true)
  })

  it('does not mistake a per-fire job conversation for one', () => {
    expect(isTaskThread({ id: 's_0e1b2c3d_1111_4111_8111_111111111111', jobId: DEFINITION })).toBe(
      false,
    )
  })

  it('is false for a conversation a person started', () => {
    expect(isTaskThread({ id: taskThreadConversationId(DEFINITION), jobId: null })).toBe(false)
  })
})
