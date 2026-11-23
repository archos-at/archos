/**
 * @vitest-environment node
 *
 * „Melden“ on a mail that poses as a member: one press dismisses it, records
 * the report and warns the project's managers (the office admins among them)
 * and the member it poses as, each exactly once, naming the mail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = vi.hoisted(() => ({ mail: null as unknown, decisions: [] as unknown[] }))

vi.mock('./access', () => ({ requireMailReviewer: vi.fn(async () => ({ closed: false })) }))
vi.mock('./service', () => ({
  requireMail: vi.fn(async () => store.mail),
  dismissAsDecided: vi.fn(async () => ({ mails: [store.mail], written: { decisions: store.decisions }, closed: false })),
}))
vi.mock('./mail-views', () => ({
  maskRulesFor: vi.fn(async () => null),
  mailViews: vi.fn(async (_s: unknown, _p: string, mails: Array<{ id: string }>) => mails.map((mail) => ({ id: mail.id, status: 'handled' }))),
}))
vi.mock('@/lib/authz/project-membership', () => ({
  PERMISSION_CHECKS_AT_ONCE: 8,
  userHoldsProjectPermission: vi.fn(),
  userHoldsProjectPermissionStrict: vi.fn(),
}))
vi.mock('@/lib/sharing/directory', () => ({ loadOrganizationDirectory: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg: vi.fn(async () => ({ id: 'project', name: 'Wohnbau Hietzing' })) }))
vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(async (rows: unknown[]) => rows.length),
  openRecipientsOf: vi.fn(async () => []),
  resolveInboxItemsFor: vi.fn(async () => 0),
  resolveInboxItemsAnchoredOn: vi.fn(async () => 0),
}))
vi.mock('@/lib/audit/after-commit', () => ({ recordAuditEventAfterCommit: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))

import { NotFoundError } from '@/lib/api/errors'
import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import { userHoldsProjectPermission } from '@/lib/authz/project-membership'
import { emitInboxItems, type InboxEmission } from '@/lib/inbox/service'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { MAIL_ID, PROJECT_ID, heldMail } from './__fixtures__/review'
import { requireMailReviewer } from './access'
import { reportInboundMail } from './report'
import { dismissAsDecided } from './service'

const REPORTER = 'user_reporter'
const MANAGER = 'user_manager'
const ADMIN = 'user_office_admin'
const CLAIMED = 'user_miriam'
const WRITER = 'user_writer'

const PERMISSIONS: Record<string, readonly string[]> = {
  [REPORTER]: ['project:view', 'project:documents:write'],
  [MANAGER]: ['project:view', 'project:manage'],
  [ADMIN]: ['project:view', 'project:manage'],
  [CLAIMED]: ['project:view', 'project:documents:write'],
  [WRITER]: ['project:view', 'project:documents:write'],
}
const NAMES: Record<string, string> = {
  [REPORTER]: 'Lena Berger',
  [MANAGER]: 'Paul Wagner',
  [ADMIN]: 'Eva Schmid',
  [CLAIMED]: 'Miriam Huber',
  [WRITER]: 'Tom Klein',
}

const session = (userId = REPORTER) =>
  ({ userId, organizationId: 'org_1', email: 'lena@example.test', permissions: [] }) as unknown as AuthorizedSession

const posingByName = () =>
  heldMail({
    senderTrust: 'external_verified',
    senderUserId: null,
    senderClass: 'external',
    senderReason: 'dkim_pass',
    senderFlags: ['claims_member_name'],
    senderName: 'Miriam Huber',
    senderAddress: 'miriam.huber@mail.example',
    subject: 'Kontoänderung Honorarnote: neue IBAN AT61 1904 3002 3457 3201',
  })

const posingByAddress = () =>
  heldMail({
    senderTrust: 'member_unverified',
    senderUserId: CLAIMED,
    senderClass: 'unverified_writer',
    senderReason: 'dkim_fail',
    senderFlags: [],
    senderName: 'Miriam Huber',
    senderAddress: 'm.huber@huber-architektur.at',
    subject: 'Dringend: Kontoänderung Honorarnote',
  })

const rows = () => vi.mocked(emitInboxItems).mock.calls.flatMap(([batch]) => batch as InboxEmission[])
const told = (type: string) => rows().filter((row) => row.type === type).map((row) => row.recipientUserId).sort()

beforeEach(() => {
  vi.clearAllMocks()
  store.mail = posingByName()
  store.decisions = [{ id: 'decision-1', mailId: MAIL_ID, action: 'dismiss' }]
  vi.mocked(userHoldsProjectPermission).mockImplementation(async (_s, _p, userId, permission) => (PERMISSIONS[userId] ?? []).includes(permission))
  vi.mocked(loadOrganizationDirectory).mockResolvedValue(
    new Map(Object.keys(PERMISSIONS).map((userId) => [userId, { userId, email: null, name: NAMES[userId] ?? userId, profilePictureUrl: null }])),
  )
})

describe('reporting a mail that poses by a member’s name', () => {
  it('dismisses it as today and warns the managers and office admins, and the member it names, once each', async () => {
    const result = await reportInboundMail(session(), PROJECT_ID, MAIL_ID)

    expect(dismissAsDecided).toHaveBeenCalledTimes(1)
    expect(dismissAsDecided).toHaveBeenCalledWith(session(), PROJECT_ID, [MAIL_ID])
    expect(emitInboxItems).toHaveBeenCalledTimes(1)
    expect(told('inbound_mail.fraud_reported')).toEqual([MANAGER, ADMIN])
    expect(told('inbound_mail.rejected')).toEqual([CLAIMED])
    expect(rows()).toHaveLength(3)
    expect(result).toEqual({ mail: { id: MAIL_ID, status: 'handled' }, warned: 3 })
  })

  it('names the sender, the name it claimed and the subject, with any IBAN taken out, and anchors the row on the mail', async () => {
    await reportInboundMail(session(), PROJECT_ID, MAIL_ID)
    const warning = rows().find((row) => row.type === 'inbound_mail.fraud_reported')
    expect(warning).toMatchObject({
      resourceType: 'project',
      resourceId: PROJECT_ID,
      anchorId: MAIL_ID,
      actorUserId: REPORTER,
      groupKey: `inbound_mail.fraud_reported:project:${PROJECT_ID}:${MAIL_ID}`,
      payload: {
        subject: 'Wohnbau Hietzing',
        related: 'Miriam Huber ‹miriam.huber@mail.example›',
        excerpt: 'Kontoänderung Honorarnote: neue IBAN [IBAN entfernt]',
      },
    })
    expect(JSON.stringify(rows())).not.toContain('3457')
    const claimed = rows().find((row) => row.type === 'inbound_mail.rejected')
    expect(claimed?.payload).toEqual({ subject: 'Wohnbau Hietzing', variant: 'reported', related: 'Miriam Huber ‹miriam.huber@mail.example›' })
  })

  it('records the report and counts it in PostHog, with numbers and codes only', async () => {
    await reportInboundMail(session(), PROJECT_ID, MAIL_ID)
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound_mail.reported',
        targetType: 'inbound_mail',
        targetId: MAIL_ID,
        metadata: { projectId: PROJECT_ID, basis: 'member_name', managersWarned: 2, claimedTold: 1, own: false },
        idempotencyKey: `inbound_mail.reported:${MAIL_ID}`,
      }),
    )
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'inbound_mail_reported',
        distinctId: REPORTER,
        properties: { basis: 'member_name', managers_warned: 2, claimed_told: 1, own: false },
      }),
    )
  })

  it('warns nobody twice: the second press finds nothing waiting and is refused', async () => {
    await reportInboundMail(session(), PROJECT_ID, MAIL_ID)
    store.decisions = []
    await expect(reportInboundMail(session(), PROJECT_ID, MAIL_ID)).rejects.toMatchObject({ details: { reason: 'part_not_waiting' } })
    expect(emitInboxItems).toHaveBeenCalledTimes(1)
    expect(recordAuditEventAfterCommit).toHaveBeenCalledTimes(1)
  })

  it('never warns the reporter, even a manager reporting', async () => {
    await reportInboundMail(session(MANAGER), PROJECT_ID, MAIL_ID)
    expect(told('inbound_mail.fraud_reported')).toEqual([ADMIN])
    expect(told('inbound_mail.rejected')).toEqual([CLAIMED])
  })
})

describe('reporting a mail whose signature the member’s domain rejected', () => {
  beforeEach(() => {
    store.mail = posingByAddress()
  })

  it('tells the member it carries the address of, through the dismissal’s own notice, and warns the managers', async () => {
    PERMISSIONS[CLAIMED] = ['project:view', 'project:manage']
    try {
      const result = await reportInboundMail(session(), PROJECT_ID, MAIL_ID)
      expect(told('inbound_mail.rejected')).toEqual([CLAIMED])
      expect(told('inbound_mail.fraud_reported')).toEqual([MANAGER, ADMIN])
      expect(result.warned).toBe(3)
    } finally {
      PERMISSIONS[CLAIMED] = ['project:view', 'project:documents:write']
    }
  })

  it('warns only the managers when the member reports the forgery of their own address', async () => {
    await reportInboundMail(session(CLAIMED), PROJECT_ID, MAIL_ID)
    expect(told('inbound_mail.fraud_reported')).toEqual([MANAGER, ADMIN])
    expect(told('inbound_mail.rejected')).toEqual([])
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ basis: 'rejected_signature', own: true }) }))
  })
})

describe('what cannot be reported', () => {
  it('refuses a mail that poses as nobody, and dismisses and tells nothing', async () => {
    store.mail = heldMail()
    await expect(reportInboundMail(session(), PROJECT_ID, MAIL_ID)).rejects.toMatchObject({ details: { reason: 'not_impersonation' } })
    store.mail = heldMail({ senderTrust: 'member_unverified', senderReason: 'dkim_none', senderFlags: ['not_addressed_to_project'] })
    await expect(reportInboundMail(session(), PROJECT_ID, MAIL_ID)).rejects.toMatchObject({ details: { reason: 'not_impersonation' } })
    expect(dismissAsDecided).not.toHaveBeenCalled()
    expect(emitInboxItems).not.toHaveBeenCalled()
    expect(recordAuditEventAfterCommit).not.toHaveBeenCalled()
  })

  it('needs the right to dismiss: someone who may not review the project’s mail learns nothing and changes nothing', async () => {
    vi.mocked(requireMailReviewer).mockRejectedValueOnce(new NotFoundError())
    await expect(reportInboundMail(session(), PROJECT_ID, MAIL_ID)).rejects.toBeInstanceOf(NotFoundError)
    expect(dismissAsDecided).not.toHaveBeenCalled()
    expect(emitInboxItems).not.toHaveBeenCalled()
  })
})
