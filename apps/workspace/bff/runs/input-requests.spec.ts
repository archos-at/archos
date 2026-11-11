/**
 * @vitest-environment node
 */
/**
 * A run's question to a person (ADR-0181): what may be asked, what counts as an
 * answer, that the first final word stands, and that the run's ledger follows
 * (`waiting` on the first question, `running` when none is left open).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
  withPlatformAccess: vi.fn(async (_why: string, run: () => Promise<unknown>) => run()),
}))
vi.mock('@/lib/tasks/repository', () => ({ findRunById: vi.fn() }))
vi.mock('./service', () => ({ applyRunLedgerOp: vi.fn(), requireRunActor: vi.fn() }))
vi.mock('./input-request-repository', () => ({
  insertOrFind: vi.fn(),
  countOpen: vi.fn(),
  listForRun: vi.fn(),
  findInRun: vi.fn(),
  decide: vi.fn(),
  expireDue: vi.fn(),
  cancelOpen: vi.fn(),
}))

import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { findRunById } from '@/lib/tasks/repository'
import * as repository from './input-request-repository'
import type { RunInputRequest } from './input-request-repository'
import {
  INPUT_REQUEST_LIFECYCLE,
  MAX_INPUT_PROPERTIES,
  MAX_OPEN_INPUT_REQUESTS,
  inputContentProblems,
  inputRequestCreateSchema,
  inputRequestResolveProblem,
  inputRequestResolveSchema,
  inputRequestViewSchema,
  requestedSchemaSchema,
  type RequestedSchema,
} from './input-request-types'
import { askForInput, listInputRequests, readInputRequestForRun, resolveInputRequest } from './input-requests'
import { applyRunLedgerOp, requireRunActor } from './service'

const NOW = new Date('2026-11-11T12:00:00.000Z')
const RUN_ID = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const REQUEST_ID = '0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c'
const SESSION = { userId: 'user_1', organizationId: 'org_1' } as Partial<AuthorizedSession> as AuthorizedSession

const SCALE_SCHEMA: RequestedSchema = {
  type: 'object',
  properties: {
    scale: { type: 'string', title: 'Scale', enum: ['1:50', '1:100', '1:200'] },
    reference_length_m: { type: 'number', minimum: 0.1, maximum: 500 },
    confirmed: { type: 'boolean' },
  },
  required: ['scale'],
}

const run = (status: TaskRun['status'] = 'running') =>
  ({ id: RUN_ID, organizationId: 'org_1', projectId: 'project_1', status }) as Partial<TaskRun> as TaskRun

const row = (overrides: Partial<RunInputRequest> = {}): RunInputRequest => ({
  id: REQUEST_ID,
  organizationId: 'org_1',
  projectId: 'project_1',
  runId: RUN_ID,
  idempotencyKey: 'scale:page-1',
  reason: 'confirmation',
  message: 'Is 1:100 the scale of the floor plan on page 1?',
  requestedSchema: SCALE_SCHEMA,
  status: 'open',
  content: null,
  decidedBy: null,
  decidedAt: null,
  expiresAt: null,
  createdAt: NOW,
  ...overrides,
})

const ask = { reason: 'confirmation', message: row().message, requestedSchema: SCALE_SCHEMA, idempotencyKey: 'scale:page-1' } as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findRunById).mockResolvedValue(run())
  vi.mocked(requireRunActor).mockResolvedValue(run())
  vi.mocked(repository.countOpen).mockResolvedValue(0)
  vi.mocked(repository.expireDue).mockResolvedValue(0)
  vi.mocked(repository.cancelOpen).mockResolvedValue(0)
})

describe('what may be asked', () => {
  it('takes a flat object of primitives, as MCP form elicitation does', () => {
    expect(requestedSchemaSchema.safeParse(SCALE_SCHEMA).success).toBe(true)
  })

  it('refuses a nested value, an empty request, too many values and an unknown required name', () => {
    const nested = { type: 'object', properties: { place: { type: 'object', properties: {} } } }
    expect(requestedSchemaSchema.safeParse(nested).success).toBe(false)
    expect(requestedSchemaSchema.safeParse({ type: 'object', properties: {} }).success).toBe(false)
    const many = Object.fromEntries(Array.from({ length: MAX_INPUT_PROPERTIES + 1 }, (_, i) => [`v${i}`, { type: 'boolean' }]))
    expect(requestedSchemaSchema.safeParse({ type: 'object', properties: many }).success).toBe(false)
    expect(requestedSchemaSchema.safeParse({ ...SCALE_SCHEMA, required: ['missing'] }).success).toBe(false)
  })

  it('refuses a number range that cannot be met', () => {
    const schema = { type: 'object', properties: { n: { type: 'number', minimum: 5, maximum: 1 } } }
    expect(requestedSchemaSchema.safeParse(schema).success).toBe(false)
  })

  it('needs the worker’s own key, and takes no run id in the body', () => {
    expect(inputRequestCreateSchema.safeParse({ ...ask, idempotencyKey: undefined }).success).toBe(false)
    expect(inputRequestCreateSchema.safeParse({ ...ask, runId: RUN_ID }).success).toBe(false)
  })
})

describe('what counts as an answer', () => {
  it('accepts values that fit the schema', () => {
    expect(inputContentProblems(SCALE_SCHEMA, { scale: '1:100', reference_length_m: 5.24, confirmed: true })).toEqual([])
  })

  it('names every misfit: a missing required value, an unasked one, a wrong type, a value off the list or out of range', () => {
    expect(inputContentProblems(SCALE_SCHEMA, {})).toEqual(['scale is required'])
    expect(inputContentProblems(SCALE_SCHEMA, { scale: '1:100', extra: 1 })).toEqual(['extra was not asked for'])
    expect(inputContentProblems(SCALE_SCHEMA, { scale: '1:75' })).toEqual(['scale must be one of the offered values'])
    expect(inputContentProblems(SCALE_SCHEMA, { scale: '1:100', reference_length_m: 0 })).toEqual([
      'reference_length_m must be at least 0.1',
    ])
    expect(inputContentProblems(SCALE_SCHEMA, { scale: '1:100', confirmed: 'yes' })).toEqual(['confirmed must be true or false'])
  })

  it('holds a whole number to being whole', () => {
    const schema: RequestedSchema = { type: 'object', properties: { storeys: { type: 'integer', minimum: 1 } } }
    expect(inputContentProblems(schema, { storeys: 2.5 })).toEqual(['storeys must be a whole number'])
    expect(inputContentProblems(schema, { storeys: 3 })).toEqual([])
  })

  it('pairs accept with content and decline with none', () => {
    expect(inputRequestResolveProblem({ action: 'accept' })).toBe('accept needs content')
    expect(inputRequestResolveProblem({ action: 'decline', content: {} })).toBe('decline takes no content')
    expect(inputRequestResolveProblem({ action: 'decline' })).toBeNull()
    expect(inputRequestResolveSchema.safeParse({ action: 'cancel' }).success).toBe(false)
  })
})

describe('the lifecycle', () => {
  it('leaves `open` four ways and never comes back', () => {
    expect([...INPUT_REQUEST_LIFECYCLE.liveStates]).toEqual(['open'])
    expect(INPUT_REQUEST_LIFECYCLE.next('open', 'answer')).toBe('answered')
    expect(INPUT_REQUEST_LIFECYCLE.next('open', 'decline')).toBe('declined')
    expect(INPUT_REQUEST_LIFECYCLE.next('open', 'cancel')).toBe('cancelled')
    expect(INPUT_REQUEST_LIFECYCLE.next('open', 'expire')).toBe('expired')
    for (const state of ['answered', 'declined', 'cancelled', 'expired'] as const) {
      expect(INPUT_REQUEST_LIFECYCLE.isFinal(state)).toBe(true)
    }
  })
})

describe('the run asks', () => {
  it('stores the question under the run’s own organization and project and moves the ledger to waiting', async () => {
    vi.mocked(repository.insertOrFind).mockResolvedValue({ row: row(), created: true })
    const view = await askForInput(RUN_ID, ask, NOW)
    expect(repository.insertOrFind).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1', projectId: 'project_1', runId: RUN_ID, idempotencyKey: 'scale:page-1' })
    )
    expect(applyRunLedgerOp).toHaveBeenCalledWith(RUN_ID, { op: 'append', status: 'waiting' }, NOW)
    expect(inputRequestViewSchema.safeParse(view).success).toBe(true)
    expect(view).toMatchObject({ id: REQUEST_ID, status: 'open' })
    expect(view).not.toHaveProperty('content')
  })

  it('answers a retried post with the first request and moves nothing', async () => {
    vi.mocked(repository.insertOrFind).mockResolvedValue({ row: row(), created: false })
    await askForInput(RUN_ID, ask, NOW)
    expect(applyRunLedgerOp).not.toHaveBeenCalled()
  })

  it('still stores the question for a run that has no message to carry a ledger', async () => {
    vi.mocked(repository.insertOrFind).mockResolvedValue({ row: row(), created: true })
    vi.mocked(applyRunLedgerOp).mockRejectedValueOnce(new NotFoundError('This run has no message to write a ledger into'))
    await expect(askForInput(RUN_ID, ask, NOW)).resolves.toMatchObject({ status: 'open' })
  })

  it('refuses an unknown run, an ended run, a deadline in the past and one question too many', async () => {
    vi.mocked(findRunById).mockResolvedValueOnce(null)
    await expect(askForInput(RUN_ID, ask, NOW)).rejects.toBeInstanceOf(NotFoundError)

    vi.mocked(findRunById).mockResolvedValueOnce(run('succeeded'))
    await expect(askForInput(RUN_ID, ask, NOW)).rejects.toBeInstanceOf(ConflictError)

    await expect(askForInput(RUN_ID, { ...ask, expiresAt: '2026-11-11T11:59:00.000Z' }, NOW)).rejects.toBeInstanceOf(BadRequestError)

    vi.mocked(repository.countOpen).mockResolvedValueOnce(MAX_OPEN_INPUT_REQUESTS)
    await expect(askForInput(RUN_ID, ask, NOW)).rejects.toBeInstanceOf(ConflictError)
    expect(repository.insertOrFind).not.toHaveBeenCalled()
  })

  it('reads its request back, with the answer once there is one', async () => {
    vi.mocked(repository.findInRun).mockResolvedValue(
      row({ status: 'answered', content: { scale: '1:200' }, decidedBy: 'user_1', decidedAt: NOW })
    )
    await expect(readInputRequestForRun(RUN_ID, REQUEST_ID, NOW)).resolves.toMatchObject({
      status: 'answered',
      content: { scale: '1:200' },
      decidedBy: 'user_1',
    })
  })
})

describe('a person answers', () => {
  it('stores a fitting answer under the person’s name and lets the run go on when none is left open', async () => {
    vi.mocked(repository.findInRun).mockResolvedValue(row())
    vi.mocked(repository.decide).mockResolvedValue(
      row({ status: 'answered', content: { scale: '1:200' }, decidedBy: 'user_1', decidedAt: NOW })
    )
    const view = await resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'accept', content: { scale: '1:200' } }, NOW)
    expect(requireRunActor).toHaveBeenCalledWith(SESSION, 'project_1', RUN_ID, { write: true })
    expect(repository.decide).toHaveBeenCalledWith(
      { organizationId: 'org_1', runId: RUN_ID },
      REQUEST_ID,
      { event: 'answer', content: { scale: '1:200' } },
      'user_1',
      NOW
    )
    expect(applyRunLedgerOp).toHaveBeenCalledWith(RUN_ID, { op: 'append', status: 'running' }, NOW)
    expect(view).toMatchObject({ status: 'answered', content: { scale: '1:200' } })
  })

  it('keeps the run waiting while another question is open', async () => {
    vi.mocked(repository.findInRun).mockResolvedValue(row())
    vi.mocked(repository.decide).mockResolvedValue(row({ status: 'declined', decidedBy: 'user_1', decidedAt: NOW }))
    vi.mocked(repository.countOpen).mockResolvedValue(1)
    await resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'decline' }, NOW)
    expect(repository.decide).toHaveBeenCalledWith(expect.anything(), REQUEST_ID, { event: 'decline' }, 'user_1', NOW)
    expect(applyRunLedgerOp).not.toHaveBeenCalled()
  })

  it('refuses an answer that does not fit, and stores nothing', async () => {
    vi.mocked(repository.findInRun).mockResolvedValue(row())
    await expect(
      resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'accept', content: { scale: '1:75' } }, NOW)
    ).rejects.toBeInstanceOf(BadRequestError)
    await expect(resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'accept' }, NOW)).rejects.toBeInstanceOf(
      BadRequestError
    )
    expect(repository.decide).not.toHaveBeenCalled()
  })

  it('lets the first final word stand: a settled request, and a race lost at the write', async () => {
    vi.mocked(repository.findInRun).mockResolvedValueOnce(row({ status: 'answered', content: { scale: '1:100' }, decidedBy: 'user_2', decidedAt: NOW }))
    await expect(
      resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'decline' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)

    vi.mocked(repository.findInRun).mockResolvedValueOnce(row())
    vi.mocked(repository.decide).mockResolvedValueOnce(null)
    await expect(
      resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'decline' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('answers 404 for a request that is not this run’s', async () => {
    vi.mocked(repository.findInRun).mockResolvedValue(null)
    await expect(
      resolveInputRequest(SESSION, 'project_1', RUN_ID, REQUEST_ID, { action: 'decline' }, NOW)
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('stale requests are settled before anything reads them', () => {
  it('expires what is past its deadline, and cancels the open questions of a run that has ended', async () => {
    vi.mocked(repository.listForRun).mockResolvedValue({ rows: [], next: null })
    await listInputRequests(SESSION, 'project_1', RUN_ID, { limit: 20 }, NOW)
    expect(repository.expireDue).toHaveBeenCalledWith({ organizationId: 'org_1', runId: RUN_ID }, NOW)
    expect(repository.cancelOpen).not.toHaveBeenCalled()

    vi.mocked(requireRunActor).mockResolvedValueOnce(run('failed'))
    await listInputRequests(SESSION, 'project_1', RUN_ID, { limit: 20 }, NOW)
    expect(repository.cancelOpen).toHaveBeenCalledWith({ organizationId: 'org_1', runId: RUN_ID }, NOW)
  })
})

describe('the list pages', () => {
  it('hands back a cursor while another page follows, and takes it for the next', async () => {
    const next = { createdAt: '2026-11-11T12:00:00.000000', id: REQUEST_ID }
    vi.mocked(repository.listForRun).mockResolvedValueOnce({ rows: [row()], next })
    const first = await listInputRequests(SESSION, 'project_1', RUN_ID, { limit: 1 }, NOW)
    expect(first.requests).toHaveLength(1)
    expect(first.nextCursor).toEqual(expect.any(String))

    vi.mocked(repository.listForRun).mockResolvedValueOnce({ rows: [], next: null })
    const second = await listInputRequests(SESSION, 'project_1', RUN_ID, { limit: 1, cursor: first.nextCursor ?? '' }, NOW)
    expect(repository.listForRun).toHaveBeenLastCalledWith({ organizationId: 'org_1', runId: RUN_ID }, { limit: 1, cursor: next })
    expect(second.nextCursor).toBeNull()
  })

  it('refuses a cursor it did not write', async () => {
    await expect(listInputRequests(SESSION, 'project_1', RUN_ID, { limit: 20, cursor: 'not-a-cursor' }, NOW)).rejects.toBeInstanceOf(
      BadRequestError
    )
    expect(repository.listForRun).not.toHaveBeenCalled()
  })
})
