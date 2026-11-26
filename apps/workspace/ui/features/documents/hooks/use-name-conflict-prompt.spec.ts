import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ConflictRow } from '../lib/name-conflict'
import { useNameConflictPrompt, type ConflictAnswer } from './use-name-conflict-prompt'

const row = (key: string): ConflictRow => ({
  key,
  path: key,
  name: key,
  within: 'folder',
  choice: 'keep_both',
  keepBothAs: `${key} 2`,
})

describe('useNameConflictPrompt', () => {
  it('asks one question at a time, in the order asked, and hands each its own answer', async () => {
    const { result } = renderHook(() => useNameConflictPrompt())
    let first: Promise<ConflictAnswer | null> = Promise.resolve(null)
    let second: Promise<ConflictAnswer | null> = Promise.resolve(null)

    act(() => {
      first = result.current.ask({ operation: 'move', folderName: 'Statik', rows: [row('a')] })
      second = result.current.ask({ operation: 'upload', folderName: '', rows: [row('b')] })
    })
    expect(result.current.question).toMatchObject({ operation: 'move', rows: [{ key: 'a' }] })
    const firstId = result.current.question?.id

    act(() => result.current.resolve(new Map([['a', 'skip']])))
    await expect(first).resolves.toEqual(new Map([['a', 'skip']]))
    expect(result.current.question).toMatchObject({ operation: 'upload', rows: [{ key: 'b' }] })
    expect(result.current.question?.id).not.toBe(firstId)

    act(() => result.current.resolve(null))
    await expect(second).resolves.toBeNull()
    expect(result.current.question).toBeNull()
  })

  it('answers a question with no rows at once, without showing it', async () => {
    const { result } = renderHook(() => useNameConflictPrompt())
    let answer: Promise<ConflictAnswer | null> = Promise.resolve(null)
    act(() => {
      answer = result.current.ask({ operation: 'upload', folderName: '', rows: [] })
    })
    await expect(answer).resolves.toEqual(new Map())
    expect(result.current.question).toBeNull()
  })
})
