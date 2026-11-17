import { describe, expect, test } from 'vitest'
import {
  bucketFor,
  filterCounts,
  groupByRecency,
  matchesFilter,
  taskResultTarget,
  type TaskRunView,
} from './task-view'

describe('taskResultTarget', () => {
  const row = (overrides: Partial<TaskRunView> = {}): TaskRunView => ({
    id: 't1',
    kind: 'document',
    title: 'Aktenvermerk',
    goal: null,
    status: 'succeeded',
    review: null,
    reviewReason: null,
    filedDocumentId: null,
    conversationId: null,
    runMessageId: null,
    taskId: null,
    trigger: 'delegated',
    requesterUserId: 'user_anna',
    requesterName: 'Anna Berger',
    createdAt: '2026-09-15T08:00:00.000Z',
    finishedAt: null,
    error: null,
    ...overrides,
  })

  test('a filed document wins over everything else it could offer', () => {
    const target = taskResultTarget('p1', row({
      filedDocumentId: 'doc-9',
      conversationId: 'conv-1',
    }))
    expect(target).toEqual({ kind: 'document', href: '/app/projects/p1/files?doc=doc-9' })
  })

  test('a run with no message of its own still opens the thread it wrote into', () => {
    const target = taskResultTarget('p1', row({ conversationId: 'conv-1' }))
    expect(target).toEqual({ kind: 'conversation', href: '/app/projects/p1/chat?session=conv-1' })
  })

  test('a run with its own message opens the thread AT that message', () => {
    const target = taskResultTarget(
      'p1',
      row({ id: 'run-7', conversationId: 'conv-1', runMessageId: 'msg-7' }),
    )
    expect(target).toEqual({
      kind: 'conversation',
      href: '/app/projects/p1/chat?session=conv-1&run=run-7#message-msg-7',
    })
  })

  test('a finished run that filed nothing and has no thread points nowhere', () => {
    expect(taskResultTarget('p1', row({}))).toBeNull()
  })

  test('a failure points at its own message, where what it tried is written', () => {
    expect(
      taskResultTarget(
        'p1',
        row({ id: 'run-3', status: 'failed', conversationId: 'conv-1', runMessageId: 'msg-3' }),
      ),
    ).toEqual({
      kind: 'conversation',
      href: '/app/projects/p1/chat?session=conv-1&run=run-3#message-msg-3',
    })
  })

  test('a run still going is followed in its thread, not in a panel', () => {
    expect(
      taskResultTarget(
        'p1',
        row({ id: 'run-4', status: 'running', conversationId: 'conv-1', runMessageId: 'msg-4' }),
      ),
    ).toEqual({
      kind: 'conversation',
      href: '/app/projects/p1/chat?session=conv-1&run=run-4#message-msg-4',
    })
  })

  test('a submission that never reached the agent points nowhere, and says so', () => {
    expect(taskResultTarget('p1', row({ status: 'error' }))).toBeNull()
  })

  test('ids are encoded — a project or document id is not a URL fragment', () => {
    const target = taskResultTarget('p 1', row({ filedDocumentId: 'a/b' }))
    expect(target?.href).toBe('/app/projects/p%201/files?doc=a%2Fb')
  })
})

describe('task filters', () => {
  const at = (overrides: Partial<TaskRunView>): TaskRunView => ({
    id: 'x',
    kind: 'document',
    title: 't',
    goal: null,
    status: 'succeeded',
    review: null,
    reviewReason: null,
    filedDocumentId: null,
    conversationId: null,
    runMessageId: null,
    taskId: null,
    trigger: 'delegated',
    requesterUserId: 'u',
    requesterName: null,
    createdAt: '2026-09-15T08:00:00.000Z',
    finishedAt: null,
    error: null,
    ...overrides,
  })

  test('unreviewed is finished work nobody has judged — reviewing it clears it', () => {
    expect(matchesFilter(at({ status: 'succeeded', review: null }), 'unreviewed')).toBe(true)
    expect(matchesFilter(at({ status: 'succeeded', review: 'accepted' }), 'unreviewed')).toBe(false)
    expect(matchesFilter(at({ status: 'succeeded', review: 'rejected' }), 'unreviewed')).toBe(false)
    expect(matchesFilter(at({ status: 'running' }), 'unreviewed')).toBe(false)
  })

  test('failed covers a broken run AND a submission that never reached the agent', () => {
    expect(matchesFilter(at({ status: 'failed' }), 'failed')).toBe(true)
    expect(matchesFilter(at({ status: 'error' }), 'failed')).toBe(true)
  })

  test('a deliberate stop is not a failure and does not pad the failure list', () => {
    for (const status of ['interrupted', 'skipped'] as const) {
      expect(matchesFilter(at({ status }), 'failed')).toBe(false)
      expect(matchesFilter(at({ status }), 'active')).toBe(false)
      expect(matchesFilter(at({ status }), 'unreviewed')).toBe(false)
      expect(matchesFilter(at({ status }), 'all')).toBe(true)
    }
  })

  test('the counts are what each chip would show, zeros included', () => {
    const counts = filterCounts([
      at({ id: '1', status: 'running' }),
      at({ id: '2', status: 'succeeded', review: null }),
      at({ id: '3', status: 'succeeded', review: 'accepted' }),
    ])
    expect(counts).toEqual({ all: 3, active: 1, unreviewed: 1, failed: 0 })
  })
})

describe('groupByRecency', () => {
  const now = new Date('2026-09-15T14:00:00.000Z')
  const at = (id: string, createdAt: string): TaskRunView => ({
    id,
    kind: 'document',
    title: id,
    goal: null,
    status: 'succeeded',
    review: null,
    reviewReason: null,
    filedDocumentId: null,
    conversationId: null,
    runMessageId: null,
    taskId: null,
    trigger: 'delegated',
    requesterUserId: 'u',
    requesterName: null,
    createdAt,
    finishedAt: null,
    error: null,
  })

  test('buckets by local calendar day, not by a 24-hour subtraction', () => {
    const today = new Date(now)
    today.setHours(1, 0, 0, 0)
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(23, 0, 0, 0)

    expect(bucketFor(today.toISOString(), now)).toBe('today')
    expect(bucketFor(yesterday.toISOString(), now)).toBe('yesterday')
  })

  test('keeps the newest bucket first and drops the empty ones', () => {
    const older = new Date(now)
    older.setDate(older.getDate() - 20)
    const groups = groupByRecency([at('a', now.toISOString()), at('b', older.toISOString())], now)
    expect(groups.map((group) => group.bucket)).toEqual(['today', 'earlier'])
  })

  test('order inside a bucket is the order the server sent — no second opinion', () => {
    const [group] = groupByRecency(
      [at('a', now.toISOString()), at('b', now.toISOString())],
      now,
    )
    expect(group.tasks.map((task) => task.id)).toEqual(['a', 'b'])
  })
})
