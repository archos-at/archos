/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = vi.hoisted(() => ({
  mail: null as unknown,
  parts: [] as unknown[],
  write: vi.fn(),
  proposalId: undefined as string | undefined,
  agent: false,
  acting: false,
}))

vi.mock('./access', () => ({ requireMailReviewer: vi.fn(async () => ({ closed: false })) }))
vi.mock('./candidates', async () => ({
  ...(await vi.importActual<typeof import('./candidates')>('./candidates')),
  candidatesFor: vi.fn(async () => ({
    threads: () => ({ shown: [], hidden: 0 }),
    part: () => ({ duplicateOf: null, revisionCandidate: null, revisionCandidateHidden: false }),
    readsFolder: () => true,
    readsDocument: () => true,
    filedAs: () => null,
  })),
}))
vi.mock('./audit', () => ({ auditDecisions: vi.fn(async () => true) }))
vi.mock('./decision', async () => {
  const actual = await vi.importActual<typeof import('./decision')>('./decision')
  return { ...actual, requireDecisionRights: vi.fn(async () => undefined) }
})
vi.mock('./repository', async () => {
  class MailChangedError extends Error {
    constructor(readonly mailId: string) {
      super('changed')
    }
  }
  class PartNotWaitingError extends Error {
    constructor(readonly mailId: string) {
      super('not waiting')
    }
  }
  return {
    MailChangedError,
    PartNotWaitingError,
    findProjectMail: vi.fn(async () => store.mail),
    findMailParts: vi.fn(async () => store.parts),
    findFollowDeciders: vi.fn(async () => new Map()),
    findFiledVias: vi.fn(async () => new Map()),
    findLiveFolders: vi.fn(async (_p: string, ids: string[]) => new Map(ids.map((id) => [id, 'Tragwerk']))),
    findThreadDocuments: vi.fn(async () => []),
    findCandidateDocuments: vi.fn(async () => []),
    writeMailDecisions: store.write,
    dismissMails: vi.fn(async () => ({ decisions: [] })),
    restoreMailParts: vi.fn(async () => ({ decisions: [] })),
    hasOpenParts: vi.fn(async () => false),
    listProjectMails: vi.fn(async () => []),
  }
})
vi.mock('./staging', () => ({ readStagedObject: vi.fn(async () => new TextEncoder().encode('raw bytes')) }))
vi.mock('./malware-scan', () => ({ scanForStorage: vi.fn(async () => ({ status: 'infected', engine: null, signature: 'Eicar', scannedAt: new Date() })) }))
vi.mock('@/lib/upload-screening/service', () => ({ gatePolicy: vi.fn(async () => ({ enabled: true, nameTerms: [], nameExceptions: [] })) }))
vi.mock('@/lib/upload-screening/content-screen', () => ({
  chatScreeningRules: () => ({}),
  maskText: (text: string) => {
    const masked = text.replace(/AT\d{18}/g, '[IBAN]')
    return { text: masked, findings: masked === text ? [] : [{ kind: 'iban', count: 1 }] }
  },
}))
vi.mock('@/lib/documents/accepted-types', () => ({
  acceptedTypesForOrganization: vi.fn(async () => ['.pdf']),
  isAcceptedType: (name: string, accepted: readonly string[]) => accepted.includes(name.slice(name.lastIndexOf('.'))),
}))
vi.mock('@/lib/agent-api/acting-session', () => ({
  actingProposalId: () => store.proposalId,
  actingReaderIsAgent: () => store.agent,
  currentActingSession: () => (store.acting ? {} : undefined),
}))
vi.mock('@/lib/audit/after-commit', () => ({ recordAuditEventAfterCommit: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('./suggest-scores', () => ({ scoreMailDecision: vi.fn(() => 'all') }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))
vi.mock('./announce', () => ({
  announceDecided: vi.fn(async () => true),
  announceWaiting: vi.fn(async () => true),
  settleFilingFailed: vi.fn(async () => undefined),
  settleHeld: vi.fn(async () => undefined),
  settleProjectNotices: vi.fn(async () => undefined),
}))
vi.mock('./notice-repository', () => ({ partStatesOf: vi.fn(async () => new Map()) }))

import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import { announceDecided, announceWaiting, settleFilingFailed, settleProjectNotices } from './announce'
import { partStatesOf } from './notice-repository'
import { FILE_PART_ID, FOLDER_ID, MAIL_ID, PERSON, PROJECT_ID, filePart, heldMail, textPart } from './__fixtures__/review'
import { auditDecisions } from './audit'
import { mailIfMatch } from './decision'
import { MailChangedError, PartNotWaitingError } from './repository'
import { scoreMailDecision } from './suggest-scores'
import { candidatesFor } from './candidates'
import { findFiledVias, findFollowDeciders, findThreadDocuments, listProjectMails, restoreMailParts } from './repository'
import {
  decisionActor,
  dismissInboundMails,
  fileInboundMails,
  filingJobId,
  getInboundMail,
  getInboundMailText,
  listInboundMails,
  readInboundMailOriginal,
  readInboundMailPart,
  restoreInboundMail,
} from './service'
import { readStagedObject } from './staging'

const session = {
  userId: PERSON,
  organizationId: 'org_1',
  email: 'lena@example.test',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [],
} as unknown as AuthorizedSession

beforeEach(() => {
  vi.clearAllMocks()
  store.mail = heldMail({ subject: 'Rechnung, IBAN AT611904300234573201' })
  store.parts = [textPart(), filePart()]
  store.proposalId = undefined
  store.agent = false
  store.acting = false
  store.write.mockImplementation(async (writes: Array<{ files: Array<{ id: string; partId: string }> }>) => ({
    decisions: writes.flatMap((write) => write.files.map((file) => ({ ...file, mailId: MAIL_ID, action: 'file' }))),
  }))
})

describe('how a decision reached us', () => {
  it('is the app, an outside agent acting as the person, or an agent’s card, read from the call', () => {
    expect(decisionActor(session)).toEqual({ decidedBy: PERSON, via: 'app', proposalId: null })
    store.acting = true
    store.agent = true
    expect(decisionActor(session)).toMatchObject({ via: 'agent' })
    store.proposalId = 'prop-1'
    expect(decisionActor(session)).toEqual({ decidedBy: PERSON, via: 'agent_proposal', proposalId: 'prop-1' })
  })
})

describe('what a reader is shown', () => {
  it('masks the subject for every reader and carries no text or bytes', async () => {
    const view = await getInboundMail(session, PROJECT_ID, MAIL_ID)
    expect(view.subject).toBe('Rechnung, IBAN [IBAN]')
    expect(Object.keys(view)).not.toEqual(expect.arrayContaining(['text', 'ownText', 'bytes']))
    expect(view.ifMatch).toBe(mailIfMatch(heldMail(), [textPart(), filePart()]))
    expect(view.parts.map((part) => part.kind)).toEqual(['message', 'attachment'])
  })

  it('serves an attachment only after a clean scan', async () => {
    store.parts = [textPart(), filePart({ scanStatus: 'pending', scannedAt: null })]
    await expect(readInboundMailPart(session, PROJECT_ID, MAIL_ID, FILE_PART_ID)).rejects.toMatchObject({ details: { reason: 'scan_not_clean' } })
    store.parts = [textPart(), filePart()]
    const res = await readInboundMailPart(session, PROJECT_ID, MAIL_ID, FILE_PART_ID)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/)
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(expect.objectContaining({ action: 'inbound_mail.part_read' }))
  })

  it('keeps a part under a legal hold from an agent, and serves it to the person', async () => {
    store.parts = [textPart(), filePart({ erasureDeferredAt: new Date() })]
    store.agent = true
    try {
      await expect(readInboundMailPart(session, PROJECT_ID, MAIL_ID, FILE_PART_ID)).rejects.toMatchObject({ details: { reason: 'legal_hold' } })
    } finally {
      store.agent = false
    }
    expect((await readInboundMailPart(session, PROJECT_ID, MAIL_ID, FILE_PART_ID)).status).toBe(200)
  })

  it('refuses a filed part’s staged copy, kept only for a legal hold: its document is what is read', async () => {
    store.parts = [textPart(), filePart({ state: 'filed', documentId: 'doc-1', erasureDeferredAt: new Date() })]
    await expect(readInboundMailPart(session, PROJECT_ID, MAIL_ID, FILE_PART_ID)).rejects.toMatchObject({ details: { reason: 'gone' } })
    expect(readStagedObject).not.toHaveBeenCalled()
  })

  it('scans the original whole on the request and refuses it unless clean, recording the read', async () => {
    await expect(readInboundMailOriginal(session, PROJECT_ID, MAIL_ID)).rejects.toMatchObject({
      details: { reason: 'original_not_clean', scan: 'infected' },
    })
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbound_mail.original_read', metadata: { projectId: PROJECT_ID, scan: 'infected' } }),
    )
  })
})

describe('what a mail asks of the person, on the wire', () => {
  const stored = { folderId: null, folderPath: 'Tragwerk', newFolder: false, documentType: null, reason: 'Wie S-101_B.pdf.' }

  it('offers a confirmed member’s mail with its suggestion, its attachment checked', async () => {
    store.parts = [textPart(), filePart({ suggestion: stored })]
    const view = await getInboundMail(session, PROJECT_ID, MAIL_ID)
    expect(view.parts[1]?.suggestion).toEqual(stored)
    expect(view.parts.map((part) => part.preselected)).toEqual([true, true])
    expect(view).toMatchObject({ riskLevel: 'none', impersonation: null, needsSenderAcknowledgement: false })
  })

  it('shows no suggestion and checks nothing of an impersonation, even with a suggestion stored before the rule', async () => {
    store.mail = heldMail({ subject: 'Dringend: Kontoänderung Honorarnote', senderTrust: 'member_unverified', senderReason: 'dkim_fail' })
    store.parts = [textPart(), filePart({ suggestion: stored })]
    const view = await getInboundMail(session, PROJECT_ID, MAIL_ID)
    expect(view.parts.map((part) => part.suggestion)).toEqual([null, null])
    expect(view.parts.map((part) => part.preselected)).toEqual([false, false])
    expect(view).toMatchObject({ riskLevel: 'impersonation', impersonation: 'rejected_signature', needsSenderAcknowledgement: true, incompleteReason: 'sender' })
  })

  it('lists each mail with why it is not complete, whose follow took its text, and the thread groups with their Fassungen', async () => {
    const thread = { threadId: 'thread-1', documentId: 'doc-1', name: 'Stellplatznachweis', folderPath: 'Korrespondenz', nextVersion: 4, strength: 'reference' as const, preselected: true, blocks: [], full: false }
    vi.mocked(candidatesFor).mockResolvedValueOnce({
      threads: () => ({ shown: [thread], hidden: 0 }),
      part: () => ({ duplicateOf: null, revisionCandidate: null, revisionCandidateHidden: false }),
      readsFolder: () => true,
      readsDocument: () => true,
      filedAs: () => null,
    } as never)
    const later = heldMail({ id: 'mail-later', sentAt: new Date('2026-10-14T09:00:00Z'), receivedAt: new Date('2026-10-14T09:01:00Z') })
    const earlier = heldMail({ id: 'mail-earlier', sentAt: new Date('2026-10-13T09:00:00Z'), receivedAt: new Date('2026-10-14T09:02:00Z') })
    vi.mocked(listProjectMails).mockResolvedValueOnce(
      [later, earlier].map((mail) => ({ mail, position: { receivedAt: new Date(mail.receivedAt).toISOString(), id: mail.id } })) as never,
    )
    store.parts = [textPart({ mailId: 'mail-later' }), textPart({ id: 'text-earlier', mailId: 'mail-earlier' })]
    vi.mocked(findFollowDeciders).mockResolvedValueOnce(new Map([['mail-earlier', 'user_01JFOLLOWER0000000000000000']]))

    const page = await listInboundMails(session, PROJECT_ID, { status: 'waiting', limit: 25 })

    expect(page.items.map((item) => [item.id, item.incompleteReason, item.riskLevel, item.followedBy])).toEqual([
      ['mail-later', null, 'none', null],
      ['mail-earlier', null, 'none', 'user_01JFOLLOWER0000000000000000'],
    ])
    expect(page.threadGroups).toEqual([
      {
        threadId: 'thread-1',
        name: 'Stellplatznachweis',
        mails: [
          { mailId: 'mail-earlier', version: 4 },
          { mailId: 'mail-later', version: 5 },
        ],
        firstVersion: 4,
        lastVersion: 5,
      },
    ])
  })

  it('says a handled mail was filed without a click, and where to, only when no person filed any of it (Bearbeitet)', async () => {
    const verlauf = { name: 'Statik Einreichung', folderPath: 'Korrespondenz', version: 5 }
    const plan = { name: 'S-102.pdf', folderPath: 'Tragwerk', version: 1 }
    vi.mocked(candidatesFor).mockResolvedValueOnce({
      threads: () => ({ shown: [], hidden: 0 }),
      part: () => ({ duplicateOf: null, revisionCandidate: null, revisionCandidateHidden: false }),
      readsFolder: () => true,
      readsDocument: () => true,
      filedAs: (part: { documentId: string | null }) => (part.documentId === 'doc-verlauf' ? verlauf : part.documentId === 'doc-plan' ? plan : null),
    } as never)
    const followed = heldMail({ id: 'mail-followed', status: 'settled' })
    const byPerson = heldMail({ id: 'mail-person', status: 'settled' })
    const hidden = heldMail({ id: 'mail-hidden', status: 'settled' })
    vi.mocked(listProjectMails).mockResolvedValueOnce(
      [followed, byPerson, hidden].map((mail) => ({ mail, position: { receivedAt: new Date(mail.receivedAt).toISOString(), id: mail.id } })) as never,
    )
    store.parts = [
      textPart({ id: 'text-followed', mailId: 'mail-followed', state: 'filed', documentId: 'doc-verlauf' }),
      filePart({ id: 'file-followed', mailId: 'mail-followed', state: 'filed', documentId: 'doc-plan' }),
      textPart({ id: 'text-person', mailId: 'mail-person', state: 'filed', documentId: 'doc-verlauf' }),
      filePart({ id: 'file-person', mailId: 'mail-person', state: 'filed', documentId: 'doc-plan' }),
      filePart({ id: 'file-hidden', mailId: 'mail-hidden', state: 'filed', documentId: 'doc-secret' }),
    ]
    vi.mocked(findFiledVias).mockResolvedValueOnce(
      new Map([
        ['text-followed', 'follow'],
        ['file-followed', 'follow'],
        ['text-person', 'follow'],
        ['file-person', 'app'],
        ['file-hidden', 'sender'],
      ]),
    )

    const page = await listInboundMails(session, PROJECT_ID, { status: 'handled', limit: 25 })

    expect(page.items.map((item) => [item.id, item.filedWithoutClick])).toEqual([
      ['mail-followed', { to: verlauf }],
      ['mail-person', null],
      ['mail-hidden', { to: null }],
    ])
  })

  it('reads who a forwarded mail came from off the masked quote, never as a trust label', async () => {
    store.mail = heldMail({ subject: 'WG: Verhandlungsschrift' })
    const read = {
      readerVersion: 1,
      bodySource: 'plain',
      ownText: 'Zur Ablage.',
      ownTextTruncated: false,
      split: true,
      signatureRemoved: false,
      quoted: [{ header: '-----Ursprüngliche Nachricht-----', text: 'Von: MA 37 – Baupolizei <post@ma37.wien.gv.at>\nGesendet: Montag' }],
      quotedTruncated: false,
      calendar: [],
      calendarTruncated: false,
      encrypted: false,
      unreadableReasons: [],
      unreadable: false,
    }
    vi.mocked(readStagedObject).mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(read)) as never)
    const text = await getInboundMailText(session, PROJECT_ID, MAIL_ID)
    expect(text.forwardedFrom).toEqual({ name: 'MA 37 – Baupolizei', address: 'post@ma37.wien.gv.at' })
  })
})

describe('a decision', () => {
  const body = () => ({
    mails: [
      {
        mailId: MAIL_ID,
        ifMatch: mailIfMatch(heldMail(), [textPart(), filePart()]),
        parts: [{ partId: FILE_PART_ID, folderId: FOLDER_ID, newFolderPath: null, name: 'S-101_C.pdf' }],
        message: null,
      },
    ],
  })

  it('writes the rows, the claims and the filing job together, as the person, then tells the trail', async () => {
    const result = await fileInboundMails(session, PROJECT_ID, body())
    const [writes, actor, , , job] = store.write.mock.calls[0] as [Array<{ files: Array<{ id: string }> }>, unknown, unknown, Date, { jobId: string; payload: { requester: { userId: string } } }]
    expect(actor).toEqual({ decidedBy: PERSON, via: 'app', proposalId: null })
    const firstId = writes[0]!.files[0]!.id
    expect(job.jobId).toBe(filingJobId(firstId))
    expect(job.payload).toMatchObject({ projectId: PROJECT_ID, mailIds: [MAIL_ID], decisionIds: [firstId], requester: { userId: PERSON } })
    expect(result.filingJobId).toBe(job.jobId)
    expect(auditDecisions).toHaveBeenCalledTimes(1)
  })

  it('scores the agent’s suggestion against the parts as they were, and tells PostHog whether it was followed', async () => {
    const before = [textPart(), filePart({ suggestion: { folderId: FOLDER_ID, folderPath: 'Tragwerk' } })]
    store.parts = before
    await fileInboundMails(session, PROJECT_ID, body())
    const scored = vi.mocked(scoreMailDecision).mock.calls[0]![0]
    expect(scored).toMatchObject({ organizationId: 'org_1', decidedBy: PERSON, via: 'app', parts: before, decision: body().mails[0] })
    expect(scored.folderPathOf(FOLDER_ID)).toBe('Tragwerk')
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'inbound_mail_decided', properties: expect.objectContaining({ suggestion_followed: 'all', risk_level: 'none' }) }),
    )
  })

  it('says on the decision whether the mail posed as someone (risk_level)', async () => {
    const { dismissMails } = await import('./repository')
    store.mail = heldMail({ subject: 'Dringend: Kontoänderung Honorarnote', senderTrust: 'member_unverified', senderReason: 'dkim_fail' })
    vi.mocked(dismissMails).mockResolvedValueOnce({ decisions: [{ mailId: MAIL_ID, action: 'dismiss' }] } as never)
    await dismissInboundMails(session, PROJECT_ID, { mailIds: [MAIL_ID] })
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'inbound_mail_decided', properties: expect.objectContaining({ risk_level: 'impersonation' }) }),
    )
  })

  it('scores a dismissed mail’s suggestions as not followed', async () => {
    const { dismissMails } = await import('./repository')
    vi.mocked(dismissMails).mockResolvedValueOnce({ decisions: [{ mailId: MAIL_ID, action: 'dismiss' }] } as never)
    vi.mocked(scoreMailDecision).mockReturnValueOnce('none')
    await dismissInboundMails(session, PROJECT_ID, { mailIds: [MAIL_ID] })
    expect(vi.mocked(scoreMailDecision).mock.calls[0]![0]).toMatchObject({ decision: null, parts: [textPart(), filePart()] })
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ suggestion_followed: 'none', files: 0, dismissed: 1, risk_level: 'none' }) }),
    )
  })

  it('settles the project’s notices by what it still holds, and the mails’ failed filings, after a decision', async () => {
    await fileInboundMails(session, PROJECT_ID, body())
    expect(settleProjectNotices).toHaveBeenCalledWith('org_1', PROJECT_ID)
    expect(settleFilingFailed).toHaveBeenCalledWith('org_1', [MAIL_ID])
  })

  it('tells a member sender their mail was dismissed once nothing of it waits, and nothing while a part still does', async () => {
    const { dismissMails } = await import('./repository')
    vi.mocked(dismissMails).mockResolvedValue({ decisions: [{ mailId: MAIL_ID, action: 'dismiss' }] } as never)
    vi.mocked(partStatesOf).mockResolvedValueOnce(new Map([[MAIL_ID, ['dismissed', 'dismissed']]]))
    await dismissInboundMails(session, PROJECT_ID, { mailIds: [MAIL_ID] })
    expect(announceDecided).toHaveBeenCalledWith(expect.objectContaining({ mailId: MAIL_ID, decidedBy: session.userId, outcome: 'dismissed' }))

    vi.mocked(announceDecided).mockClear()
    vi.mocked(partStatesOf).mockResolvedValueOnce(new Map([[MAIL_ID, ['dismissed', 'filing']]]))
    await dismissInboundMails(session, PROJECT_ID, { mailIds: [MAIL_ID] })
    expect(announceDecided).not.toHaveBeenCalled()

    vi.mocked(partStatesOf).mockResolvedValueOnce(new Map([[MAIL_ID, ['filed', 'dismissed']]]))
    await dismissInboundMails(session, PROJECT_ID, { mailIds: [MAIL_ID] })
    expect(announceDecided).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'filed' }))
    vi.mocked(dismissMails).mockResolvedValue({ decisions: [] })
  })

  it('tells a member sender their mail was dismissed when a file call dismisses all of it', async () => {
    store.write.mockResolvedValueOnce({ decisions: [{ mailId: MAIL_ID, partId: FILE_PART_ID, action: 'dismiss' }] })
    vi.mocked(partStatesOf).mockResolvedValueOnce(new Map([[MAIL_ID, ['dismissed', 'dismissed']]]))
    const dismissAll = body()
    dismissAll.mails[0]!.parts = []
    await fileInboundMails(session, PROJECT_ID, dismissAll)
    expect(announceDecided).toHaveBeenCalledWith(expect.objectContaining({ mailId: MAIL_ID, outcome: 'dismissed' }))
  })

  it('leaves telling a filed mail to its filing job', async () => {
    vi.mocked(partStatesOf).mockResolvedValue(new Map([[MAIL_ID, ['dismissed', 'filed']]]))
    await fileInboundMails(session, PROJECT_ID, body())
    expect(announceDecided).not.toHaveBeenCalled()
    vi.mocked(partStatesOf).mockResolvedValue(new Map())
  })

  it('refuses a bulk decision whose appends would overfill a thread, before any write', async () => {
    const thread = { threadId: 'thread-1', documentId: 'doc-t', name: 'Statik', folderId: null, folderPath: null, nextVersion: 200, entryCount: 199, renderedBytes: 10, participantDomains: [] }
    vi.mocked(findThreadDocuments).mockResolvedValueOnce([thread])
    const second = heldMail({ id: 'mail-second' })
    const secondParts = [textPart({ id: 'text-second', mailId: 'mail-second' })]
    vi.mocked((await import('./repository')).findProjectMail).mockImplementation(async (_p, id) => (id === 'mail-second' ? second : store.mail) as never)
    store.parts = [textPart(), filePart(), ...secondParts]
    const append = { thread: { action: 'append' as const, mailThreadId: 'thread-1' }, text: 'full' as const }
    try {
      await expect(
        fileInboundMails(session, PROJECT_ID, {
          mails: [
            { mailId: MAIL_ID, ifMatch: mailIfMatch(heldMail(), [textPart(), filePart()]), parts: [], message: { partId: textPart().id, ...append } },
            { mailId: 'mail-second', ifMatch: mailIfMatch(second, secondParts), parts: [], message: { partId: 'text-second', ...append } },
          ],
        }),
      ).rejects.toMatchObject({ details: { reason: 'thread_full', partId: 'text-second' } })
    } finally {
      vi.mocked((await import('./repository')).findProjectMail).mockImplementation(async () => store.mail as never)
    }
    expect(store.write).not.toHaveBeenCalled()
  })

  it('answers a dismissal that met a part no longer waiting as a refusal, not a failure', async () => {
    const { dismissMails } = await import('./repository')
    vi.mocked(dismissMails).mockRejectedValueOnce(new PartNotWaitingError(MAIL_ID))
    await expect(dismissInboundMails(session, PROJECT_ID, { mailIds: [MAIL_ID] })).rejects.toMatchObject({
      details: { reason: 'part_not_waiting', mailId: MAIL_ID },
    })
  })

  it('answers a lost compare-and-set as `stale`, and writes nothing else', async () => {
    store.write.mockRejectedValueOnce(new MailChangedError(MAIL_ID))
    await expect(fileInboundMails(session, PROJECT_ID, body())).rejects.toMatchObject({ details: { reason: 'stale', mailId: MAIL_ID } })
    expect(auditDecisions).not.toHaveBeenCalled()
  })

  it('refuses before any write when a rule of C2 fails', async () => {
    store.parts = [textPart(), filePart({ riskFlags: ['macro'] })]
    const changed = body()
    changed.mails[0]!.ifMatch = mailIfMatch(heldMail(), store.parts as never)
    await expect(fileInboundMails(session, PROJECT_ID, changed)).rejects.toMatchObject({ details: { reason: 'risk_not_acknowledged' } })
    expect(store.write).not.toHaveBeenCalled()
  })
})

describe('a restore', () => {
  it('tells the mail waits again and settles a stale expiry notice', async () => {
    vi.mocked(restoreMailParts).mockResolvedValueOnce({ decisions: [{ mailId: MAIL_ID, action: 'restore' }] } as never)
    await restoreInboundMail(session, PROJECT_ID, MAIL_ID)
    expect(announceWaiting).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_1', projectId: PROJECT_ID, mailId: MAIL_ID }))
    expect(settleProjectNotices).toHaveBeenCalledWith('org_1', PROJECT_ID)
  })

  it('tells nothing when nothing was restored', async () => {
    vi.mocked((await import('./repository')).hasOpenParts).mockResolvedValueOnce(true)
    await restoreInboundMail(session, PROJECT_ID, MAIL_ID)
    expect(announceWaiting).not.toHaveBeenCalled()
  })
})

describe('a mail that claims a writer, through the service (ADR-0137, amendment of 2026-11-19)', () => {
  const WRITER = 'user_01JCX0R4D8M2W6YB3N5Q7T9V1W'
  const claimed = (senderReason: 'dkim_none' | 'dkim_fail') =>
    heldMail({ senderClass: 'unverified_writer', senderTrust: 'member_unverified', senderReason, senderUserId: WRITER })

  it('shows a colleague what they may do: an unsigned one is theirs to check, an impersonation the writer’s alone', async () => {
    store.mail = claimed('dkim_none')
    expect(await getInboundMail(session, PROJECT_ID, MAIL_ID)).toMatchObject({ onlySenderReleases: false, ownClaimedMail: false, needsSenderAcknowledgement: true })
    store.mail = claimed('dkim_fail')
    expect(await getInboundMail(session, PROJECT_ID, MAIL_ID)).toMatchObject({ onlySenderReleases: true, ownClaimedMail: false })
    expect(await getInboundMail({ ...session, userId: WRITER } as AuthorizedSession, PROJECT_ID, MAIL_ID)).toMatchObject({
      onlySenderReleases: false,
      ownClaimedMail: true,
    })
  })

  it('files an unsigned one for a colleague who acknowledges it, and refuses an impersonation with `sender_only`', async () => {
    const decide = async (senderReason: 'dkim_none' | 'dkim_fail') => {
      store.mail = claimed(senderReason)
      const mail = store.mail as ReturnType<typeof heldMail>
      return fileInboundMails(session, PROJECT_ID, {
        mails: [
          {
            mailId: MAIL_ID,
            ifMatch: mailIfMatch(mail, store.parts as never),
            parts: [{ partId: FILE_PART_ID, folderId: FOLDER_ID, newFolderPath: null, name: 'S-101_C.pdf' }],
            message: null,
            acknowledgeSender: true,
          },
        ],
      })
    }
    await decide('dkim_none')
    expect(store.write).toHaveBeenCalledOnce()
    expect(store.write.mock.calls[0][0][0].files[0]).toMatchObject({ decidedBy: PERSON, acknowledgedSender: true })
    await expect(decide('dkim_fail')).rejects.toMatchObject({ details: { reason: 'sender_only' } })
    expect(store.write).toHaveBeenCalledOnce()
  })

  it('restores an unsigned one for a colleague, and refuses to restore an impersonation with `sender_only`', async () => {
    store.mail = claimed('dkim_fail')
    await expect(restoreInboundMail(session, PROJECT_ID, MAIL_ID)).rejects.toMatchObject({ details: { reason: 'sender_only' } })
    expect(restoreMailParts).not.toHaveBeenCalled()
    store.mail = claimed('dkim_none')
    await expect(restoreInboundMail(session, PROJECT_ID, MAIL_ID)).rejects.toMatchObject({ details: { reason: 'not_restorable' } })
    expect(restoreMailParts).toHaveBeenCalledOnce()
  })
})
