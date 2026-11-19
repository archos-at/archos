import 'server-only'

import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { maskText, type ContentScreenRules } from '@/lib/upload-screening/content-screen'
import { requireMailReviewer } from './access'
import { announceFraudReported } from './announce'
import { refusal } from './decision'
import type { ImpersonationBasis } from './inbound-mail-vocabulary'
import type { InboundMailReportResultView, InboundMailView } from './inbound-mail-wire'
import { mailViews, maskRulesFor } from './mail-views'
import { claimedMemberIds, impersonationOf, senderFactsOf } from './sender-risk'
import { dismissAsDecided, requireMail } from './service'

export const REPORTED_SUBJECT_MAX = 200
export const REPORTED_NAME_MAX = 120

async function noticeRules(organizationId: string, projectId: string): Promise<ContentScreenRules> {
  const office = await maskRulesFor(organizationId, projectId)
  return {
    terms: office?.terms ?? [],
    patterns: office?.patterns ?? [],
    detectors: [...new Set([...(office?.detectors ?? []), 'iban' as const])],
  }
}

function clipped(text: string | null, max: number): string | null {
  const flat = text?.replace(/\s+/gu, ' ').trim() ?? ''
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export function reportedSender(mail: Pick<InboundMailRow, 'senderName' | 'senderAddress'>, rules: ContentScreenRules): string {
  const address = mail.senderAddress?.trim() ?? ''
  const name = clipped(mail.senderName ? maskText(mail.senderName, rules).text : null, REPORTED_NAME_MAX)
  return name && address ? `${name} ‹${address}›` : name || address
}

export function reportedSubject(mail: Pick<InboundMailRow, 'subject'>, rules: ContentScreenRules): string | null {
  return clipped(mail.subject ? maskText(mail.subject, rules).text : null, REPORTED_SUBJECT_MAX)
}

async function claimedOf(mail: InboundMailRow, basis: ImpersonationBasis): Promise<string[]> {
  if (basis === 'rejected_signature') return mail.senderUserId ? [mail.senderUserId] : []
  const directory = await loadOrganizationDirectory(mail.organizationId)
  return claimedMemberIds(mail.senderName, directory.values())
}

export async function reportInboundMail(session: AuthorizedSession, projectId: string, mailId: string): Promise<InboundMailReportResultView> {
  await requireMailReviewer(session, projectId)
  const mail = await requireMail(projectId, mailId)
  const facts = senderFactsOf(mail)
  const basis = facts ? impersonationOf(facts) : null
  if (!basis) throw refusal('not_impersonation', 'Only a mail that poses as a member of the office can be reported', { mailId })

  const { written, closed } = await dismissAsDecided(session, projectId, [mailId])
  if (written.decisions.length === 0) throw refusal('part_not_waiting', 'Nothing of this mail waits any more; read it again', { mailId })

  const rules = await noticeRules(session.organizationId, projectId)
  const claimedUserIds = await claimedOf(mail, basis)
  const told = await announceFraudReported({
    organizationId: session.organizationId,
    projectId,
    mailId,
    reportedBy: session.userId,
    claimedUserIds,
    sender: reportedSender(mail, rules),
    subject: reportedSubject(mail, rules),
  })
  const warned = told.managers.length + told.claimed.length
  const own = claimedUserIds.includes(session.userId)
  recordAuditEventAfterCommit({
    action: 'inbound_mail.reported',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'inbound_mail',
    targetId: mailId,
    alsoTargets: [{ type: 'project', id: projectId }],
    metadata: { projectId, basis, managersWarned: told.managers.length, claimedTold: told.claimed.length, own },
    idempotencyKey: `inbound_mail.reported:${mailId}`,
  })
  captureServer({
    event: 'inbound_mail_reported',
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: { basis, managers_warned: told.managers.length, claimed_told: told.claimed.length, own },
  })
  const [view] = await mailViews(session, projectId, [await requireMail(projectId, mailId)], closed)
  return { mail: view as InboundMailView, warned }
}
