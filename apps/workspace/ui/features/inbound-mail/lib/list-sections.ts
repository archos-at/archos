import type { InboundMailSummaryView, InboundMailThreadGroupView } from '@/lib/inbound-mail/inbound-mail-wire'
import { isReady } from './completeness'
import { isQuietMail } from './quiet-mail'

export { isQuietMail, waitingShownCount } from './quiet-mail'

export type ListSection =
  | { kind: 'mail'; mail: InboundMailSummaryView }
  | {
      kind: 'thread'
      threadId: string
      name: string
      mails: InboundMailSummaryView[]
    }
  | { kind: 'quiet'; mails: InboundMailSummaryView[] }
  | { kind: 'readiness'; readiness: Readiness; mails: InboundMailSummaryView[] }

export type Readiness = 'ready' | 'needs_you' | 'others'

const READINESS_ORDER: readonly Readiness[] = ['ready', 'needs_you', 'others']

const DAY_MS = 86_400_000
export const EXPIRY_SOON_DAYS = 5

export function readinessOf(mail: Pick<InboundMailSummaryView, 'status' | 'incompleteReason' | 'riskLevel' | 'onlySenderReleases'>): Readiness {
  if (isReady(mail)) return 'ready'
  return mail.onlySenderReleases && mail.riskLevel !== 'impersonation' ? 'others' : 'needs_you'
}

export function daysUntilExpiry(mail: Pick<InboundMailSummaryView, 'status' | 'expiresAt'>, now: number): number | null {
  if (mail.status !== 'waiting') return null
  const left = new Date(mail.expiresAt).getTime() - now
  if (!Number.isFinite(left) || left >= EXPIRY_SOON_DAYS * DAY_MS) return null
  return Math.max(0, Math.floor(left / DAY_MS))
}

export function listSections(
  mails: readonly InboundMailSummaryView[],
  options: { grouped: boolean; groups?: readonly InboundMailThreadGroupView[]; now?: number },
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
    const entries = options.now === undefined ? halves[readiness] : expiringFirst(halves[readiness], options.now)
    sections.push({ kind: 'readiness', readiness, mails: entries.flatMap(mailsOf) })
    sections.push(...entries)
  }
  if (quiet.length > 0) sections.push({ kind: 'quiet', mails: options.now === undefined ? quiet : expiringFirst(quiet.map((mail) => ({ kind: 'mail' as const, mail })), options.now).flatMap(mailsOf) })
  return sections
}

function expiringFirst(entries: readonly ListSection[], now: number): ListSection[] {
  const soonest = (entry: ListSection): number => {
    const times = mailsOf(entry)
      .filter((mail) => daysUntilExpiry(mail, now) !== null)
      .map((mail) => new Date(mail.expiresAt).getTime())
    return times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY
  }
  return entries
    .map((entry, index) => ({ entry, index, key: soonest(entry) }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key - b.key))
    .map(({ entry }) => entry)
}

const mailsOf = (section: ListSection): InboundMailSummaryView[] =>
  section.kind === 'mail' ? [section.mail] : section.kind === 'thread' ? section.mails : []

export function hasLoudMail(sections: readonly ListSection[]): boolean {
  return sections.some((section) => section.kind === 'mail' || section.kind === 'thread')
}

export function visibleMails(sections: readonly ListSection[], quietOpen: boolean): InboundMailSummaryView[] {
  return sections.flatMap((section) => {
    if (section.kind === 'mail') return [section.mail]
    if (section.kind === 'thread') return section.mails
    if (section.kind === 'readiness') return []
    return quietOpen ? section.mails : []
  })
}
