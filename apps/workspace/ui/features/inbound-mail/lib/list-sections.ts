import type { InboundMailSummaryView, InboundMailThreadGroupView } from '@/lib/inbound-mail/inbound-mail-wire'
import { isReady } from './completeness'

export type ListSection =
  | { kind: 'mail'; mail: InboundMailSummaryView }
  | {
      kind: 'thread'
      threadId: string
      name: string
      firstVersion: number
      lastVersion: number
      mails: InboundMailSummaryView[]
    }
  | { kind: 'quiet'; mails: InboundMailSummaryView[] }
  | { kind: 'readiness'; readiness: Readiness; mails: InboundMailSummaryView[] }

export type Readiness = 'ready' | 'needs_you' | 'others'

const READINESS_ORDER: readonly Readiness[] = ['ready', 'needs_you', 'others']

export function readinessOf(mail: Pick<InboundMailSummaryView, 'status' | 'incompleteReason' | 'riskLevel' | 'onlySenderReleases'>): Readiness {
  if (isReady(mail)) return 'ready'
  return mail.onlySenderReleases && mail.riskLevel !== 'impersonation' ? 'others' : 'needs_you'
}

export function isQuietMail(mail: Pick<InboundMailSummaryView, 'senderTrust' | 'automatic' | 'riskLevel'>): boolean {
  if (mail.riskLevel === 'impersonation') return false
  return mail.automatic || mail.senderTrust === 'external_unverified'
}

export function listSections(
  mails: readonly InboundMailSummaryView[],
  options: { grouped: boolean; groups?: readonly InboundMailThreadGroupView[] },
): ListSection[] {
  if (!options.grouped) return mails.map((mail) => ({ kind: 'mail', mail }))
  const quiet = mails.filter(isQuietMail)
  const loud = mails.filter((mail) => !isQuietMail(mail))
  const byId = new Map(loud.map((mail) => [mail.id, mail]))

  const groupOf = new Map<string, ListSection & { kind: 'thread' }>()
  for (const group of options.groups ?? []) {
    const members = group.mails.map((entry) => byId.get(entry.mailId)).filter((mail): mail is InboundMailSummaryView => !!mail)
    for (const readiness of READINESS_ORDER) {
      const half = members.filter((mail) => readinessOf(mail) === readiness)
      if (half.length < 2) continue
      const section = {
        kind: 'thread' as const,
        threadId: group.threadId,
        name: group.name,
        firstVersion: group.firstVersion,
        lastVersion: group.firstVersion + half.length - 1,
        mails: half,
      }
      for (const member of half) groupOf.set(member.id, section)
    }
  }

  const halves: Record<Readiness, ListSection[]> = { ready: [], needs_you: [], others: [] }
  const placed = new Set<ListSection>()
  for (const mail of loud) {
    const group = groupOf.get(mail.id)
    if (!group) {
      halves[readinessOf(mail)].push({ kind: 'mail', mail })
      continue
    }
    if (placed.has(group)) continue
    placed.add(group)
    halves[readinessOf(mail)].push(group)
  }

  const sections: ListSection[] = []
  for (const readiness of READINESS_ORDER) {
    if (halves[readiness].length === 0) continue
    sections.push({ kind: 'readiness', readiness, mails: halves[readiness].flatMap(mailsOf) })
    sections.push(...halves[readiness])
  }
  if (quiet.length > 0) sections.push({ kind: 'quiet', mails: quiet })
  return sections
}

const mailsOf = (section: ListSection): InboundMailSummaryView[] =>
  section.kind === 'mail' ? [section.mail] : section.kind === 'thread' ? section.mails : []

export function visibleMails(sections: readonly ListSection[], quietOpen: boolean): InboundMailSummaryView[] {
  return sections.flatMap((section) => {
    if (section.kind === 'mail') return [section.mail]
    if (section.kind === 'thread') return section.mails
    if (section.kind === 'readiness') return []
    return quietOpen ? section.mails : []
  })
}
