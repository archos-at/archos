/**
 * @vitest-environment node
 *
 * The suggest job (`./suggest-job`): who is asked about, that the budget is
 * asked first, that the model reads no text, that the answer lands on the
 * parts that still wait, and that a failure leaves the mail without a
 * suggestion rather than failing anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend.test' }))

const state = vi.hoisted(() => ({
  mail: null as InboundMailRow | null,
  parts: [] as InboundMailPartRow[],
  stored: new Map<string, unknown>(),
}))

vi.mock('./repository', () => ({
  findMailForReceive: vi.fn(async () => state.mail),
  findMailParts: vi.fn(async () => state.parts),
  storePartSuggestions: vi.fn(async (_mailId: string, suggestions: Map<string, unknown>) => {
    for (const [partId, suggestion] of suggestions) state.stored.set(partId, suggestion)
    return suggestions.size
  }),
}))
vi.mock('./staging', () => ({
  readStagedObject: vi.fn(() => {
    throw new Error('the suggest job read a staged object')
  }),
}))
vi.mock('./read-client', () => ({
  readMail: vi.fn(() => {
    throw new Error('the suggest job read the mail')
  }),
}))
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: vi.fn(async () => ({ id: PROJECT_ID, status: 'active' })),
  listProjectsInOrg: vi.fn(async () => []),
}))
vi.mock('@/lib/budgets/unasked-spend', () => ({ unaskedSpendAllowed: vi.fn(async () => true) }))
vi.mock('@/lib/authz/folder-access-repository', () => ({
  listProjectFolderTree: vi.fn(async () => [
    { id: FOLDER_ID, parentId: null, accessMode: 'inherit', everyoneReads: false },
    { id: RESTRICTED_ID, parentId: null, accessMode: 'custom', everyoneReads: false },
  ]),
}))
vi.mock('@/lib/filing/repository', () => ({
  listProjectsFolders: vi.fn(async (_org: string, projectIds: string[]) =>
    projectIds.includes(PROJECT_ID)
      ? [
          { id: FOLDER_ID, projectId: PROJECT_ID, parentId: null, path: 'Tragwerk', description: 'Statik', accessMode: 'inherit' },
          { id: RESTRICTED_ID, projectId: PROJECT_ID, parentId: null, path: 'Personal', description: null, accessMode: 'custom' },
        ]
      : [],
  ),
  listFiledDocuments: vi.fn(async () => []),
}))
vi.mock('@/lib/documents/reconcile-status', () => ({ reconcileDocumentStatuses: vi.fn(async <T,>(rows: T[]) => rows) }))
vi.mock('@/lib/upload-screening/service', () => ({ gatePolicy: vi.fn(async () => ({ enabled: false })) }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/langfuse/mail-suggestion-trace', () => ({ recordMailSuggestionOutcome: vi.fn(async () => {}) }))

import { captureServer } from '@/lib/analytics/posthog-server'
import { unaskedSpendAllowed } from '@/lib/budgets/unasked-spend'
import { recordMailSuggestionOutcome } from '@/lib/langfuse/mail-suggestion-trace'
import { findProjectInOrg } from '@/lib/projects/repository'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { FILE_PART_ID, FOLDER_ID, MAIL_ID, PROJECT_ID, TEXT_PART_ID, filePart, heldMail, textPart } from './__fixtures__/review'
import { inboundMailJobId } from './receive-job'
import { storePartSuggestions } from './repository'
import { isTransientFailure, runInboundMailSuggest, suggestForMail, SuggestionRetryError } from './suggest-job'

const RESTRICTED_ID = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d'
const ORG = 'org_1'
const TRACE = 'abcdef0123456789abcdef0123456789'
const PAYLOAD = { mailId: MAIL_ID, projectId: PROJECT_ID }
const REVIEWED = { threadMatch: [], senderClass: 'external' as const, senderTrust: 'external_verified' as const, senderUserId: null }

let fetchMock: ReturnType<typeof vi.spyOn>

function answer(moves: object[], extra: object = {}) {
  fetchMock.mockResolvedValue(Response.json({ moves, model: 'm', error: null, trace_id: TRACE, ...extra }))
}

const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FILING_SUGGESTIONS', 'on')
  state.mail = heldMail(REVIEWED)
  state.parts = [textPart(), filePart()]
  state.stored = new Map()
  fetchMock = vi.spyOn(globalThis, 'fetch')
  answer([
    { id: FILE_PART_ID, folder: 'Tragwerk', type: 'Gutachten', reason: 'Die Statik.' },
    { id: TEXT_PART_ID, folder: 'Behörde und Bescheide', reason: 'Schriftverkehr mit dem Statiker.' },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the job id', () => {
  it('is derived from the mail with uuid5, never the mail id, which is the receive job’s', () => {
    const id = inboundMailJobId('suggest', MAIL_ID)
    expect(id).not.toBe(MAIL_ID)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(inboundMailJobId('suggest', MAIL_ID)).toBe(id)
    expect(inboundMailJobId('follow', MAIL_ID)).not.toBe(id)
  })
})

describe('who is asked about', () => {
  it.each([
    [
      'an outsider whose domain signed nothing',
      { senderTrust: 'external_unverified' as const, senderClass: 'external' as const, senderUserId: null, senderReason: 'dkim_none' as const },
    ],
    [
      'a member’s address its domain did not sign',
      { senderTrust: 'member_unverified' as const, senderClass: 'unverified_writer' as const, senderReason: 'dkim_none' as const },
    ],
  ])('asks about %s, within the same budget', async (_case, overrides) => {
    state.mail = heldMail({ threadMatch: [], ...overrides })
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'suggested', parts: 2 })
    expect(unaskedSpendAllowed).toHaveBeenCalledWith({ organizationId: ORG, userId: null }, PROJECT_ID)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an impersonation of a member', { senderTrust: 'member_unverified' as const, senderReason: 'dkim_fail' as const }, 'impersonation'],
    [
      'a member’s name on an outsider’s signed address',
      { senderTrust: 'external_verified' as const, senderUserId: null, senderFlags: ['claims_member_name' as const] },
      'impersonation',
    ],
    ['automatic mail', { automatic: true }, 'automatic'],
    ['a mail already decided', { status: 'settled' as const }, 'not_waiting'],
  ])('asks nothing about %s', async (_case, overrides, reason) => {
    state.mail = heldMail({ threadMatch: [], ...overrides })
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'skipped', reason })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(unaskedSpendAllowed).not.toHaveBeenCalled()
  })

  it('asks nothing about another organization’s or another project’s mail', async () => {
    expect(await suggestForMail('org_2', PAYLOAD)).toEqual({ status: 'skipped', reason: 'not_waiting' })
    expect(await suggestForMail(ORG, { ...PAYLOAD, projectId: RESTRICTED_ID })).toEqual({ status: 'skipped', reason: 'not_waiting' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks nothing when switched off for the deployment, or in a closed project', async () => {
    vi.stubEnv('FILING_SUGGESTIONS', 'off')
    expect(await suggestForMail(ORG, PAYLOAD)).toEqual({ status: 'skipped', reason: 'switched_off' })
    vi.stubEnv('FILING_SUGGESTIONS', 'on')
    vi.mocked(findProjectInOrg).mockResolvedValueOnce({ id: PROJECT_ID, status: 'closed' } as never)
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'skipped', reason: 'project_closed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks nothing, and spends nothing, when nothing can be placed', async () => {
    state.mail = heldMail()
    state.parts = [textPart(), filePart({ nameStopTerms: ['Honorar'], riskFlags: ['name_stop'] })]
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'skipped', reason: 'nothing_to_place' })
    expect(unaskedSpendAllowed).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the budget', () => {
  it('is asked before the call, for the organization and the project, as no person', async () => {
    vi.mocked(unaskedSpendAllowed).mockResolvedValueOnce(false)
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'skipped', reason: 'budget' })
    expect(unaskedSpendAllowed).toHaveBeenCalledWith({ organizationId: ORG, userId: null }, PROJECT_ID)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(storePartSuggestions).not.toHaveBeenCalled()
  })
})

describe('what the model reads', () => {
  it('reads names, the subject, the sender’s domain and the folders every member reads; never the text', async () => {
    await suggestForMail(ORG, PAYLOAD)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = sentBody()
    expect(body).toMatchObject({
      basis: 'mail',
      documents: [{ id: FILE_PART_ID, file: 'S-101_C.pdf' }],
      mail: { subject: 'AW: Statik Einreichung', sender_domain: 'statik-weber.at', text_id: TEXT_PART_ID },
    })
    expect((body.folders as Array<{ path: string }>).map((folder) => folder.path)).toEqual(['Tragwerk'])
    const sent = JSON.stringify(body)
    expect(sent).not.toContain('Personal')
    expect(sent).not.toContain('read.json')
    expect(sent).not.toContain('p.weber@')
    expect(sent).not.toContain('DI Petra Weber')
  })

  it('reads the subject masked, as every reader sees it', async () => {
    const { gatePolicy } = await import('@/lib/upload-screening/service')
    const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
    vi.mocked(gatePolicy).mockResolvedValueOnce({ ...SUGGESTED_SCREENING_POLICY, enabled: true, contentTerms: ['Einreichung'] })
    await suggestForMail(ORG, PAYLOAD)
    expect(JSON.stringify(sentBody().mail)).not.toContain('Einreichung')
  })

  it('reads the attachments’ names masked the same way', async () => {
    const { gatePolicy } = await import('@/lib/upload-screening/service')
    const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
    vi.mocked(gatePolicy).mockResolvedValueOnce({ ...SUGGESTED_SCREENING_POLICY, enabled: true, contentTerms: ['Huber'] })
    state.parts = [textPart(), filePart({ filename: 'Scheidung Huber Gutachten.pdf' })]
    await suggestForMail(ORG, PAYLOAD)
    const [document] = sentBody().documents as Array<{ file: string }>
    expect(document.file).not.toContain('Huber')
    expect(document.file).toContain('Gutachten.pdf')
    expect(vi.mocked(gatePolicy)).toHaveBeenCalledTimes(1)
  })
})

describe('the office’s conventions', () => {
  it('are folders several of its projects keep, never a folder only one other project has', async () => {
    const { listProjectsInOrg } = await import('@/lib/projects/repository')
    const { listProjectsFolders } = await import('@/lib/filing/repository')
    vi.mocked(listProjectsInOrg).mockResolvedValueOnce([{ id: 'p-a' }, { id: 'p-b' }, { id: PROJECT_ID }] as never)
    const kept = (id: string, projectId: string, path: string) => ({ id, projectId, parentId: null, path, description: null, accessMode: 'inherit' as const })
    const folders = async (_org: string, projectIds: readonly string[]) =>
      projectIds.includes(PROJECT_ID)
        ? [kept(FOLDER_ID, PROJECT_ID, 'Tragwerk')]
        : [kept('f1', 'p-a', 'Korrespondenz'), kept('f2', 'p-b', 'Korrespondenz'), kept('f3', 'p-b', 'Scheidung Huber')]
    vi.mocked(listProjectsFolders).mockImplementationOnce(folders).mockImplementationOnce(folders)
    await suggestForMail(ORG, PAYLOAD)
    expect((sentBody().conventions as Array<{ path: string }>).map((convention) => convention.path)).toEqual(['Korrespondenz'])
  })
})

describe('the answer', () => {
  it('is stored on the parts with the generation’s trace, and the project is told', async () => {
    expect(await suggestForMail(ORG, PAYLOAD)).toEqual({ status: 'suggested', asked: 2, parts: 2, traceId: TRACE, senderTrust: 'external_verified' })
    expect(vi.mocked(storePartSuggestions).mock.calls[0][2]).toBe(TRACE)
    expect(Object.fromEntries(state.stored)).toEqual({
      [FILE_PART_ID]: { folderId: FOLDER_ID, folderPath: 'Tragwerk', newFolder: false, documentType: 'Gutachten', reason: 'Die Statik.' },
      [TEXT_PART_ID]: {
        folderId: null,
        folderPath: 'Behörde und Bescheide',
        newFolder: true,
        documentType: null,
        reason: 'Schriftverkehr mit dem Statiker.',
      },
    })
    expect(publishProjectChanged).toHaveBeenCalledWith(ORG, PROJECT_ID)
  })

  it('fails open: a backend that is down leaves the mail without a suggestion and throws nothing', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'failed', reason: 'backend_503', traceId: null })
    expect(storePartSuggestions).not.toHaveBeenCalled()
    expect(publishProjectChanged).not.toHaveBeenCalled()
  })
})

describe('a mail its sender’s own filing files unseen', () => {
  const direct = { threadMatch: [], senderClass: 'verified_writer' as const }

  it('is asked about without the office’s conventions, so it is filed into an existing folder or the correspondence fallback', async () => {
    state.mail = heldMail(direct)
    expect(await suggestForMail(ORG, PAYLOAD)).toMatchObject({ status: 'suggested', asked: 2, parts: 1 })
    expect(sentBody().conventions).toEqual([])
    expect([...state.stored.values()].map((suggestion) => (suggestion as { newFolder: boolean }).newFolder)).toEqual([false])
  })

  it('keeps the conventions while direct filing is switched off, since a person then reviews it', async () => {
    vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'false')
    state.mail = heldMail(direct)
    await suggestForMail(ORG, PAYLOAD)
    expect((sentBody().conventions as unknown[]).length).toBeGreaterThan(0)
  })

  it('keeps the conventions for a mail a person reviews', async () => {
    await suggestForMail(ORG, PAYLOAD)
    expect((sentBody().conventions as unknown[]).length).toBeGreaterThan(0)
  })
})

describe('the job: a transient failure is asked again, and every outcome is recorded', () => {
  const run = (last = false) => runInboundMailSuggest(ORG, PAYLOAD, { last })
  const captured = () => vi.mocked(captureServer).mock.calls.map(([event]) => event)

  it.each(['backend_unreachable', 'backend_502', 'backend_503', 'llm_request_failed', 'llm_response_malformed'])('retries %s', (reason) => {
    expect(isTransientFailure(reason)).toBe(true)
  })

  it.each(['backend_400', 'backend_404', 'response_malformed', 'llm_not_configured', 'unexpected'])('does not retry %s', (reason) => {
    expect(isTransientFailure(reason)).toBe(false)
  })

  it('throws a transient failure to the queue, recorded with its trace, until the last attempt', async () => {
    answer([], { error: 'llm_request_failed' })
    await expect(run()).rejects.toBeInstanceOf(SuggestionRetryError)
    expect(captured()).toEqual([
      expect.objectContaining({
        event: 'inbound_mail_suggested',
        distinctId: null,
        organizationId: ORG,
        properties: expect.objectContaining({
          outcome: 'failed',
          reason: 'llm_request_failed',
          will_retry: true,
          mail_id: MAIL_ID,
          sender_trust: 'external_verified',
          langfuse_trace_id: TRACE,
        }),
      }),
    ])
    expect(recordMailSuggestionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: TRACE, mailId: MAIL_ID, status: 'failed', reason: 'llm_request_failed', willRetry: true }),
    )
  })

  it('ends on the last attempt without a suggestion, and says it will not ask again', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    await expect(run(true)).resolves.toBeUndefined()
    expect(captured()[0].properties).toMatchObject({ outcome: 'failed', reason: 'backend_503', will_retry: false, langfuse_trace_id: null })
    expect(recordMailSuggestionOutcome).not.toHaveBeenCalled()
  })

  it('does not ask again for a failure another try cannot mend', async () => {
    answer([], { error: 'llm_not_configured', trace_id: null })
    await expect(run()).resolves.toBeUndefined()
    expect(captured()[0].properties).toMatchObject({ outcome: 'failed', reason: 'llm_not_configured', will_retry: false })
  })

  it('records a suggestion on its trace, with how many parts were asked about and kept', async () => {
    await run()
    expect(captured()[0].properties).toMatchObject({ outcome: 'suggested', asked: 2, parts: 2, reason: null, langfuse_trace_id: TRACE })
    expect(recordMailSuggestionOutcome).toHaveBeenCalledWith(expect.objectContaining({ traceId: TRACE, status: 'suggested', asked: 2, stored: 2 }))
  })

  it('records a skip with its reason, and no trace exists for it', async () => {
    state.mail = heldMail({ ...REVIEWED, automatic: true })
    await run()
    expect(captured()[0].properties).toMatchObject({ outcome: 'skipped', reason: 'automatic', langfuse_trace_id: null })
    expect(recordMailSuggestionOutcome).not.toHaveBeenCalled()
  })

  it('records an unexpected error and hands it to the queue', async () => {
    vi.mocked(findProjectInOrg).mockRejectedValueOnce(new Error('database down'))
    await expect(run()).rejects.toThrow('database down')
    expect(captured()[0].properties).toMatchObject({ outcome: 'failed', reason: 'unexpected', will_retry: true })
  })
})
