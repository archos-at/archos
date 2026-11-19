import type {
  InboundMailPartView,
  InboundMailSummaryView,
  InboundMailTextView,
  InboundMailThreadCandidateView,
  InboundMailView,
} from '@/lib/inbound-mail/inbound-mail-wire'
import type { DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import { partPreselected, withReviewDefaults, type InboundMailPartBase } from '@/lib/inbound-mail/review-defaults'
import { onlySenderReleases, ownClaimedMail, senderClassOf, senderWaitReason } from '@/lib/inbound-mail/sender-class'
import type { InboundMailSuggestion } from '@/lib/inbound-mail/suggest'
import { filedTo, suggestedPlaces } from '@/lib/inbound-mail/suggested-places'
import { daysAhead, fixtureId, minutesAgo, PROJECT_ID } from './fixture-base'

let sequence = 0

const DEFAULT_SENDER: NonNullable<InboundMailView['sender']> = {
  name: 'DI Petra Weber',
  address: 'p.weber@statik-weber.at',
  domain: 'statik-weber.at',
  signerDomain: 'statik-weber.at',
  trust: 'external_verified',
  reason: 'dkim_pass',
  flags: [],
}

const PART_DEFAULT_CONTEXT = {
  projectClosed: false,
  rawScan: 'clean',
  sender: { trust: 'external_verified', reason: 'dkim_pass', flags: [] },
  threadCandidates: [{ blocks: [] }],
} as const

export function part(overrides: Partial<InboundMailPartView> & { name?: string } = {}): InboundMailPartView {
  sequence += 1
  const { name, preselected, ...rest } = overrides
  const base: InboundMailPartBase = {
    id: fixtureId(`part:${name ?? sequence}`),
    kind: 'attachment',
    position: sequence,
    filename: name ?? 'Unterlage.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1_284_000,
    state: 'waiting',
    scan: 'clean',
    scannedAt: minutesAgo(9),
    riskFlags: [],
    nameStopTerms: [],
    contentFindings: [],
    offered: true,
    lastFailure: null,
    documentId: null,
    filedAs: null,
    duplicateOf: null,
    revisionCandidate: null,
    revisionCandidateHidden: false,
    suggestion: null,
    restorableUntil: null,
    ...rest,
  }
  return { ...base, preselected: preselected ?? partPreselected(base, PART_DEFAULT_CONTEXT) }
}

export function messagePart(overrides: Partial<InboundMailPartView> = {}): InboundMailPartView {
  return part({ name: undefined, filename: null, kind: 'message', contentType: 'text/plain', sizeBytes: 4_200, scan: 'not_applicable', position: 0, ...overrides })
}

export function thread(overrides: Partial<InboundMailThreadCandidateView> = {}): InboundMailThreadCandidateView {
  return {
    threadId: fixtureId('thread:stellplatz'),
    documentId: fixtureId('doc:stellplatz'),
    name: 'Stellplatznachweis',
    folderPath: 'Korrespondenz',
    nextVersion: 4,
    strength: 'reference',
    preselected: true,
    blocks: [],
    full: false,
    ...overrides,
  }
}

/** Every preview is read by one person, Anna Berger; Miriam Huber is her colleague in the project. */
const VIEWER_ID = 'user_01JANNABERGER0000000000000'
const MEMBERS: Record<string, string> = {
  'a.berger@huber-architektur.at': VIEWER_ID,
  'm.huber@huber-architektur.at': 'user_01JMIRIAMHUBER00000000000',
}

export interface FixtureReading {
  writes?: boolean
  directFiling?: boolean
}

function judged(
  sender: InboundMailView['sender'],
  automatic: boolean,
  reading: FixtureReading,
): Pick<InboundMailView, 'senderClass' | 'waitReason' | 'onlySenderReleases' | 'ownClaimedMail'> {
  const member = sender?.trust.startsWith('member_') ? (MEMBERS[sender.address] ?? null) : null
  const directFiling = reading.directFiling ?? true
  const senderClass = sender
    ? senderClassOf({ trust: sender.trust, reason: sender.reason, senderUserId: member, flags: sender.flags, automatic, writes: reading.writes ?? true })
    : 'external'
  const facts = { senderClass, senderTrust: sender?.trust ?? null, senderFlags: sender?.flags ?? [], automatic, directFiling }
  const claimed = { senderClass, senderUserId: member, senderTrust: sender?.trust ?? null, senderReason: sender?.reason ?? null, senderFlags: sender?.flags ?? [] }
  const viewer = VIEWER_ID
  return {
    senderClass,
    waitReason: senderWaitReason(facts),
    onlySenderReleases: onlySenderReleases(claimed, viewer),
    ownClaimedMail: ownClaimedMail(claimed, viewer),
  }
}

export function mail(overrides: Partial<InboundMailView> & { key?: string; reading?: FixtureReading } = {}): InboundMailView {
  const { key, reading = {}, ...rest } = overrides
  const sender = rest.sender === undefined ? DEFAULT_SENDER : rest.sender
  const verdict = judged(sender, rest.automatic ?? false, reading)
  return withReviewDefaults({
    id: fixtureId(`mail:${key ?? 'default'}`),
    projectId: PROJECT_ID,
    status: 'waiting',
    projectClosed: false,
    ifMatch: `if-${key ?? 'default'}`,
    subject: 'AW: Stellplatznachweis – Nachreichung Statik',
    sender: DEFAULT_SENDER,
    participants: [
      { role: 'from', name: 'DI Petra Weber', address: 'p.weber@statik-weber.at' },
      { role: 'to', name: 'Miriam Huber', address: 'm.huber@huber-architektur.at' },
      { role: 'cc', name: 'MA 37 – Baupolizei', address: 'post@ma37.wien.gv.at' },
    ],
    sentAt: minutesAgo(14),
    receivedAt: minutesAgo(12),
    expiresAt: daysAhead(verdict.senderClass === 'external' ? 14 : 30),
    automatic: false,
    rawScan: 'clean',
    originalHeld: true,
    notStaged: [],
    parts: [messagePart({ id: fixtureId(`message:${key ?? 'default'}`) })],
    threadCandidates: [thread()],
    hiddenThreadCandidates: 0,
    followedBy: null,
    senderFolders: [],
    updatedAt: minutesAgo(9),
    ...verdict,
    ...rest,
  })
}

export function text(overrides: Partial<InboundMailTextView> = {}): InboundMailTextView {
  return {
    ownText:
      'Sehr geehrte Frau Huber,\n\nanbei die überarbeitete Statik S-101 in Index D. Die Stellplätze im Hof sind jetzt mit der neuen Lastannahme gerechnet.\n\nBitte um kurze Rückmeldung bis Freitag, ob die Fassung so an die MA 37 gehen kann.\n\nDie Unterlagen liegen auch unter https://cloud.statik-weber.at/s/9fK2 bereit.\n\nMit freundlichen Grüßen\nPetra Weber',
    ownTextTruncated: false,
    quoted: [
      {
        header: 'Am 12.11.2026 um 16:40 schrieb Miriam Huber <m.huber@huber-architektur.at>:',
        text: 'Liebe Frau Weber,\n\nkönnen Sie uns die Statik mit den geänderten Stellplätzen bis Ende der Woche schicken?\n\nDanke und lg\nMiriam Huber',
      },
    ],
    calendar: [],
    masked: false,
    unreadable: false,
    forwardedFrom: null,
    ...overrides,
  }
}

export function summaryOf(view: InboundMailView, overrides: Partial<InboundMailSummaryView> = {}): InboundMailSummaryView {
  const attachments = view.parts.filter((candidate) => candidate.kind === 'attachment')
  const preferred = view.threadCandidates.find((candidate) => candidate.preselected) ?? view.threadCandidates[0] ?? null
  return {
    id: view.id,
    projectId: view.projectId,
    status: view.status,
    subject: view.subject,
    senderName: view.sender?.name ?? null,
    senderDomain: view.sender?.domain ?? null,
    senderTrust: view.sender?.trust ?? null,
    senderFlags: view.sender?.flags ?? [],
    automatic: view.automatic,
    receivedAt: view.receivedAt,
    expiresAt: view.expiresAt,
    attachments: attachments.length,
    waitingParts: view.parts.filter((candidate) => candidate.state === 'waiting').length,
    outcomes: {
      filed: view.parts.filter((candidate) => candidate.state === 'filed').length,
      dismissed: view.parts.filter((candidate) => candidate.state === 'dismissed').length,
      expired: view.parts.filter((candidate) => candidate.state === 'expired').length,
    },
    restorableUntil: view.parts.map((candidate) => candidate.restorableUntil).find((until): until is string => !!until) ?? null,
    thread: preferred ? { threadId: preferred.threadId, name: preferred.name, nextVersion: preferred.nextVersion, preselected: preferred.preselected } : null,
    riskLevel: view.riskLevel,
    impersonation: view.impersonation,
    senderClass: view.senderClass,
    waitReason: view.waitReason,
    onlySenderReleases: view.onlySenderReleases,
    ownClaimedMail: view.ownClaimedMail,
    incompleteReason: view.incompleteReason,
    followedBy: view.followedBy,
    filedWithoutClick: null,
    filedTo: filedTo(view),
    suggestedPlaces: suggestedPlaces(view),
    updatedAt: view.updatedAt,
    ...overrides,
  }
}

export const suggestion = (
  folderPath: string,
  documentType: DocumentTypeTag | null,
  reason: string,
  { newFolder = false }: { newFolder?: boolean } = {},
): InboundMailSuggestion => ({ folderId: null, folderPath, newFolder, documentType, reason })

export const statik = (overrides: Partial<InboundMailPartView> = {}) =>
  part({
    name: 'S-101_D.pdf',
    sizeBytes: 2_480_000,
    revisionCandidate: { documentId: fixtureId('doc:s101'), name: 'S-101_C.pdf', folderPath: 'Tragwerk', nextVersion: 4 },
    suggestion: suggestion('Tragwerk', null, 'Gleiche Plannummer wie S-101_C.pdf in Tragwerk.'),
    ...overrides,
  })

export const permitDecision = (overrides: Partial<InboundMailPartView> = {}) =>
  part({
    name: 'Bescheid_MA37_2026-10-14.pdf',
    sizeBytes: 412_000,
    suggestion: suggestion('Behörde/Bescheide', 'Bescheid', 'Der Dateiname nennt einen Bescheid der MA 37; Bescheide liegen in Behörde/Bescheide.'),
    ...overrides,
  })
