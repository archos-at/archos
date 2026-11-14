import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTenantContext } from '@/lib/db/tenant-context'
import type { BffJobRow } from '@/lib/db/schema/bff-job-queue'
import { inJobSlice } from './slice-scope'
import { emptyCounts, type ReindexProjectPayload } from './types'

/** The row a run took; each case says which. */
const takenRow = vi.fn<() => Promise<BffJobRow>>()

const runReindexSlice = vi.fn()
const runReingestFailedSlice = vi.fn()
const runBimExtractJob = vi.fn()
const runOfficeRenditionJob = vi.fn()
vi.mock('@/lib/documents/extraction-jobs', () => ({
  runBimExtractJob: (...args: unknown[]) => runBimExtractJob(...args),
  runOfficeRenditionJob: (...args: unknown[]) => runOfficeRenditionJob(...args),
}))
vi.mock('@/lib/documents/ingest-recovery', () => ({
  runReingestFailedSlice: (...args: unknown[]) => runReingestFailedSlice(...args),
}))
vi.mock('@/lib/documents/reindex', () => ({
  runReindexSlice: (...args: unknown[]) => runReindexSlice(...args),
}))

const runRestoreFolderSlice = vi.fn()
const runPurgeBinnedChunksSlice = vi.fn()
vi.mock('@/lib/projects/folder-bin-jobs', () => ({
  runRestoreFolderSlice: (...args: unknown[]) => runRestoreFolderSlice(...args),
  runPurgeBinnedChunksSlice: (...args: unknown[]) => runPurgeBinnedChunksSlice(...args),
}))

const runReportFilingJob = vi.fn()
vi.mock('@/lib/tasks/service', () => ({
  runReportFilingJob: (...args: unknown[]) => runReportFilingJob(...args),
}))

const runAgentWake = vi.fn()
vi.mock('@/lib/annotations/wake-job', () => ({
  runAgentWake: (...args: unknown[]) => runAgentWake(...args),
}))

const runAgentWakeStop = vi.fn()
vi.mock('@/lib/annotations/wake-stop-job', () => ({
  runAgentWakeStop: (...args: unknown[]) => runAgentWakeStop(...args),
}))

const resolvePinnedRequesterSession = vi.fn()
vi.mock('@/lib/auth/pinned-session', () => ({
  resolvePinnedRequesterSession: (...args: unknown[]) => resolvePinnedRequesterSession(...args),
}))

import { runHandler } from './run'

/** One slice of the taken row, as the `bff-job` task runs it, its answer as the row would keep it. */
async function runJobSlice() {
  const job = await takenRow()
  const result = await runHandler({ kind: job.kind, organizationId: job.lane, payload: job.payload, attempts: job.attempts })
  if (!result.done && result.notBefore) return { done: false, payload: result.payload, notBefore: result.notBefore.toISOString() }
  return { done: result.done, payload: result.payload }
}

const requester = {
  userId: 'user-1',
  email: 'user@example.com',
  organizationMembershipId: 'om-1',
  role: 'admin',
  permissions: ['org:settings:manage'],
}

const payload: ReindexProjectPayload = { projectId: 'p-1', requester, cursor: null, counts: emptyCounts() }

const row = (overrides: Partial<BffJobRow> = {}): BffJobRow => ({
  jobId: 'job-1',
  kind: 'reindex_project',
  lane: 'org-1',
  priority: 1,
  payload,
  status: 'claimed',
  attempts: 1,
  claimedBy: 'w-0',
  claimedAt: new Date(),
  heartbeatAt: new Date(),
  createdAt: new Date(),
  lastError: null,
  notBefore: null,
  deadAt: null,
  ...overrides,
})

beforeEach(() => {
  takenRow.mockReset()
  runReindexSlice.mockReset()
  runReingestFailedSlice.mockReset()
  runBimExtractJob.mockReset()
  runOfficeRenditionJob.mockReset()
  runReportFilingJob.mockReset()
  runRestoreFolderSlice.mockReset()
  runPurgeBinnedChunksSlice.mockReset()
  runAgentWake.mockReset()
  // Who the identity provider says the requester is today: the role they hold now, not the one they clicked with.
  resolvePinnedRequesterSession.mockReset()
  resolvePinnedRequesterSession.mockImplementation(async ({ userId, email, organizationId }) => ({
    userId,
    email,
    name: null,
    accessToken: '',
    organizationId,
    organizationMembershipId: 'om-now',
    role: 'admin',
    permissions: ['org:settings:manage'],
    featureFlags: null,
  }))
  vi.unstubAllEnvs()
})

describe('runHandler', () => {
  it('runs the handler marked as a job slice, so nothing it calls reads a request it has not got', async () => {
    takenRow.mockResolvedValue(row())
    let marked: boolean | undefined
    runReindexSlice.mockImplementation(async (_session, state) => {
      marked = inJobSlice()
      return { done: true, payload: state }
    })

    await runJobSlice()

    expect(marked).toBe(true)
    expect(inJobSlice()).toBe(false)
  })

  it('runs the slice of the row’s kind as the requester, inside the row’s organization', async () => {
    takenRow.mockResolvedValue(row())
    let seenScope: ReturnType<typeof getTenantContext>
    runReindexSlice.mockImplementation(async (_session, state) => {
      seenScope = getTenantContext()
      return { done: false, payload: { ...state, cursor: { createdAt: 'x', id: 'y' } } }
    })

    const outcome = await runJobSlice()

    expect(outcome.done).toBe(false)
    expect(outcome.payload).toMatchObject({ cursor: { createdAt: 'x', id: 'y' } })
    // The session is the requester's identity in the LANE's organization, as the
    // identity provider has it today (the membership of now, not of the click),
    // with no access token to forward anywhere.
    expect(resolvePinnedRequesterSession).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@example.com',
      organizationId: 'org-1',
    })
    expect(runReindexSlice.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      organizationMembershipId: 'om-now',
      role: 'admin',
      permissions: ['org:settings:manage'],
      accessToken: '',
    })
    expect(seenScope!).toMatchObject({ kind: 'tenant', organizationId: 'org-1' })
    expect(runReingestFailedSlice).not.toHaveBeenCalled()
  })

  it('does not carry on with the rights a requester had when they clicked', async () => {
    takenRow.mockResolvedValue(row())
    resolvePinnedRequesterSession.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      name: null,
      accessToken: '',
      organizationId: 'org-1',
      organizationMembershipId: 'om-now',
      role: 'member', // demoted since: the payload still says admin with the permission
      permissions: [],
      featureFlags: null,
    })
    runReindexSlice.mockResolvedValue({ done: true, payload })

    await runJobSlice()

    expect(runReindexSlice.mock.calls[0][0]).toMatchObject({ role: 'member', permissions: [] })
  })

  it('ends a walk quietly for a requester who is no longer in the organization', async () => {
    takenRow.mockResolvedValue(row({ kind: 'reingest_failed', payload: { requester, cursor: null, counts: emptyCounts() } }))
    resolvePinnedRequesterSession.mockResolvedValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const outcome = await runJobSlice()

    expect(outcome.done).toBe(true) // finished, not failed: a retry would be refused the same way
    expect(runReingestFailedSlice).not.toHaveBeenCalled()
    expect(runReindexSlice).not.toHaveBeenCalled()
  })

  it('takes the organization from the lane, never from the payload', async () => {
    takenRow.mockResolvedValue(row({ lane: 'org-lane', payload: { ...payload, requester } }))
    runReindexSlice.mockResolvedValue({ done: true, payload })

    await runJobSlice()

    expect(runReindexSlice.mock.calls[0][0].organizationId).toBe('org-lane')
  })

  it('dispatches the rescan kind to its own handler', async () => {
    takenRow.mockResolvedValue(
      row({ kind: 'reingest_failed', payload: { requester, cursor: null, counts: emptyCounts() } })
    )
    runReingestFailedSlice.mockResolvedValue({ done: true, payload: {} })

    const outcome = await runJobSlice()

    expect(outcome.done).toBe(true)
    expect(runReingestFailedSlice).toHaveBeenCalledTimes(1)
    expect(runReindexSlice).not.toHaveBeenCalled()
  })

  describe('the Papierkorb walks', () => {
    const restore = {
      projectId: 'p-1',
      folderId: 'f-1',
      jobId: '7d2c5e5e-8f0a-4c43-9d4c-2f6f0b1c2a11',
      requester,
      cursor: null,
      counts: emptyCounts(),
    }
    const purge = { projectId: 'p-1', folderId: 'f-1', entryId: 'q-1', requester, cursor: null, documents: 0 }

    it('runs a restore as the requester of today, and saves where it got to', async () => {
      takenRow.mockResolvedValue(row({ kind: 'restore_folder_bin', payload: restore }))
      runRestoreFolderSlice.mockImplementation(async (_session, state) => ({ done: false, payload: { ...state, cursor: 'doc-25' } }))

      const outcome = await runJobSlice()

      expect(resolvePinnedRequesterSession).toHaveBeenCalledWith({ userId: 'user-1', email: 'user@example.com', organizationId: 'org-1' })
      expect(runRestoreFolderSlice.mock.calls[0][0]).toMatchObject({ organizationId: 'org-1', organizationMembershipId: 'om-now' })
      expect(outcome).toMatchObject({ done: false, payload: { cursor: 'doc-25' } })
    })

    it('finishes a delete’s chunk purge as the system, whoever deleted, and says when the attempt is the last', async () => {
      takenRow.mockResolvedValue(row({ kind: 'purge_binned_chunks', payload: purge, attempts: 3 }))
      // The person who deleted has left: the purge still runs.
      resolvePinnedRequesterSession.mockResolvedValue(null)
      runPurgeBinnedChunksSlice.mockImplementation(async (_organizationId, state) => ({ done: true, payload: state }))

      const outcome = await runJobSlice()

      expect(outcome.done).toBe(true)
      expect(resolvePinnedRequesterSession).not.toHaveBeenCalled()
      expect(runPurgeBinnedChunksSlice).toHaveBeenCalledWith('org-1', expect.objectContaining(purge), { last: true })
    })
  })

  it('runs a wake of Piloti, and hands its wait to the runner as a time, not as a failure', async () => {
    const wake = {
      wakeId: '44444444-4444-4444-8444-444444444444',
      trigger: 'thread_mention',
      eventId: 'reply-1',
      documentId: '11111111-1111-4111-8111-111111111111',
      annotationId: '22222222-2222-4222-8222-222222222222',
      actor: { userId: 'user-1', email: null },
      waits: 0,
    }
    takenRow.mockResolvedValue(row({ kind: 'piloti_wake', payload: wake, attempts: 3 }))
    const notBefore = new Date('2026-10-13T10:00:15Z')
    runAgentWake.mockResolvedValue({ done: false, payload: { ...wake, waits: 1 }, notBefore })

    await expect(runJobSlice()).resolves.toEqual({
      done: false,
      payload: { ...wake, waits: 1 },
      notBefore: '2026-10-13T10:00:15.000Z',
    })
    expect(runAgentWake).toHaveBeenCalledWith('org-1', wake, { last: true })
  })

  it('runs the stop of a wake’s turn as the system: no session, one step, the stored payload', async () => {
    const stop = {
      wakeId: '44444444-4444-4444-8444-444444444444',
      documentId: '11111111-1111-4111-8111-111111111111',
      annotationId: '22222222-2222-4222-8222-222222222222',
      actorUserId: 'user-1',
    }
    takenRow.mockResolvedValue(row({ kind: 'piloti_wake_stop', payload: stop, attempts: 2 }))
    runAgentWakeStop.mockResolvedValue(undefined)

    await expect(runJobSlice()).resolves.toEqual({ done: true, payload: stop })
    expect(runAgentWakeStop).toHaveBeenCalledWith('org-1', stop, { last: false, retry: true })
    expect(resolvePinnedRequesterSession).not.toHaveBeenCalled()
  })

  it('refuses a stored stop that does not parse, and a stop that threw', async () => {
    takenRow.mockResolvedValue(row({ kind: 'piloti_wake_stop', payload: { wakeId: 'nope' } }))
    await expect(runJobSlice()).rejects.toThrow()
    expect(runAgentWakeStop).not.toHaveBeenCalled()

    takenRow.mockResolvedValue(
      row({
        kind: 'piloti_wake_stop',
        payload: {
          wakeId: '44444444-4444-4444-8444-444444444444',
          documentId: '11111111-1111-4111-8111-111111111111',
          annotationId: '22222222-2222-4222-8222-222222222222',
          actorUserId: 'user-1',
        },
      })
    )
    runAgentWakeStop.mockRejectedValue(new Error('the stop reached no server'))
    await expect(runJobSlice()).rejects.toThrow(/no server/)
  })

  it('fails the attempt for a kind it does not know', async () => {
    takenRow.mockResolvedValue(row({ kind: 'make_coffee' }))

    await expect(runJobSlice()).rejects.toThrow(/No handler for job kind "make_coffee"/)
  })

  describe('the one-step kinds, which run as the system', () => {
    const document = {
      projectId: 'proj-1',
      documentId: 'doc-1',
      filename: 'haus.ifc',
      storageKey: 'org/org-1/project/proj-1/doc/doc-1/haus.ifc',
      storageBucket: null,
      collectionName: 'proj_abc',
    }

    it('runs bim_extract in the lane’s organization and answers done, with no session', async () => {
      takenRow.mockResolvedValue(row({ kind: 'bim_extract', payload: document }))
      let seenScope: ReturnType<typeof getTenantContext>
      runBimExtractJob.mockImplementation(async () => {
        seenScope = getTenantContext()
      })

      const outcome = await runJobSlice()

      expect(outcome.done).toBe(true)
      expect(runBimExtractJob).toHaveBeenCalledWith('org-1', expect.objectContaining(document), { last: false, retry: false })
      expect(seenScope!).toMatchObject({ kind: 'tenant', organizationId: 'org-1' })
      expect(runOfficeRenditionJob).not.toHaveBeenCalled()
    })

    it('runs office_rendition with the row’s own file name', async () => {
      takenRow.mockResolvedValue(
        row({ kind: 'office_rendition', payload: { ...document, filename: 'a.docx', fileName: 'a.docx' } })
      )

      const outcome = await runJobSlice()

      expect(outcome.done).toBe(true)
      expect(runOfficeRenditionJob).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ fileName: 'a.docx' }),
        { last: false, retry: false }
      )
    })

    it('runs file_research_report for the reader’s identity or the pinned requester alike', async () => {
      const payload = { runId: 'run-1', projectId: 'proj-1', report: '# Bericht', taskRunId: null, requester }
      takenRow.mockResolvedValue(row({ kind: 'file_research_report', payload }))

      expect((await runJobSlice()).done).toBe(true)
      expect(runReportFilingJob).toHaveBeenCalledWith('org-1', expect.objectContaining(payload), { last: false, retry: false })

      runReportFilingJob.mockClear()
      takenRow.mockResolvedValue(row({ kind: 'file_research_report', payload: { ...payload, requester: null } }))

      expect((await runJobSlice()).done).toBe(true)
      expect(runReportFilingJob.mock.calls[0][1].requester).toBeNull()
    })

    it('tells a handler when the attempt it runs is the last one the queue gives', async () => {
      takenRow.mockResolvedValue(row({ kind: 'bim_extract', payload: document, attempts: 3 }))

      await runJobSlice()
      expect(runBimExtractJob.mock.calls[0][2]).toEqual({ last: true, retry: true })

      // The runner's own knob, read where the BFF in the same pod can see it.
      vi.stubEnv('BFF_JOBS_MAX_ATTEMPTS', '5')
      await runJobSlice()
      expect(runBimExtractJob.mock.calls[1][2]).toEqual({ last: false, retry: true })
    })

    it('fails the attempt for a payload that does not parse', async () => {
      takenRow.mockResolvedValue(row({ kind: 'bim_extract', payload: { documentId: 'doc-1' } }))

      await expect(runJobSlice()).rejects.toThrow()

      expect(runBimExtractJob).not.toHaveBeenCalled()
    })

    it('lets a failure of the step reach the runner, which spends the attempt', async () => {
      takenRow.mockResolvedValue(row({ kind: 'bim_extract', payload: document }))
      runBimExtractJob.mockRejectedValue(new Error('object store down'))

      await expect(runJobSlice()).rejects.toThrow('object store down')
    })
  })

  it('fails the attempt for a payload nobody can read, instead of guessing', async () => {
    takenRow.mockResolvedValue(row({ payload: { projectId: 'p-1' } }))

    await expect(runJobSlice()).rejects.toThrow()

    expect(runReindexSlice).not.toHaveBeenCalled()
  })
})
