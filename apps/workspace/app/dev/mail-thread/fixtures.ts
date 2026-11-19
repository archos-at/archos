import type { ProjectPerson } from '@/adapters/api/folder-access-client'
import type { MailThreadClient } from '@/features/documents/components/mail-thread/client'
import type { FetchedDownload } from '@/lib/browser-download'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'
import type {
  MailThreadAttachmentView,
  MailThreadEntryView,
  MailThreadFollowView,
  MailThreadSummaryView,
  MailThreadView,
} from '@/lib/mail-thread/mail-thread-wire'
import { ApiRequestError } from '@/adapters/api/api-error'
import { fixtureId } from '../inbound-mail/fixtures'

export const PROJECT_ID = 'p-dev-1'
export const VIEWER_ID = 'user_01JVIEWER00000000000000000'
export const THREAD_DOCUMENT_ID = fixtureId('doc:stellplatz')
export const THREAD_FOLDER_ID = fixtureId('folder:korrespondenz')
export const FIXTURE_NOW = Date.parse('2026-10-22T09:30:00.000Z')

const DAY = 86_400_000
const at = (offsetMs: number): string => new Date(FIXTURE_NOW + offsetMs).toISOString()
const daysAgo = (days: number): string => at(-days * DAY)
const daysAhead = (days: number): string => at(days * DAY)

export function attachment(overrides: Partial<MailThreadAttachmentView> & { position: number }): MailThreadAttachmentView {
  return { filename: 'Unterlage.pdf', disposition: 'filed', documentId: fixtureId(`doc:att:${overrides.position}`), documentVersionId: fixtureId(`ver:att:${overrides.position}`), visible: true, ...overrides }
}

const MINUTE = 60_000

export function printedHeading(sentAt: string, name: string, domain: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(sentAt))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')} · ${name} (${domain})`
}

export function entry(overrides: Partial<MailThreadEntryView> & { key: string; version: number }): MailThreadEntryView {
  const { key, version, ...rest } = overrides
  const sentAt = rest.sentAt ?? '2026-10-14T07:12:00.000Z'
  const senderName = rest.senderName ?? 'Mag. Huber'
  const senderDomain = rest.senderDomain ?? 'ma37.wien.gv.at'
  const receivedAt = rest.receivedAt ?? new Date(Date.parse(sentAt) + MINUTE).toISOString()
  return {
    id: fixtureId(`entry:${key}`),
    heading: printedHeading(sentAt, senderName, senderDomain),
    source: 'inbound',
    senderName,
    senderDomain,
    signerDomain: senderDomain,
    senderTrust: 'external_verified',
    forwardedBy: null,
    sentAt,
    receivedAt,
    firstVersion: { id: fixtureId(`ver:thread:${version}`), number: version },
    original: { scanStatus: 'clean' },
    attachments: [],
    filedBy: VIEWER_ID,
    filedVia: 'app',
    filedAt: new Date(Date.parse(receivedAt) + 40 * MINUTE).toISOString(),
    ...rest,
  }
}

export function follow(overrides: Partial<MailThreadFollowView> & { userId: string }): MailThreadFollowView {
  return {
    id: fixtureId(`follow:${overrides.userId}`),
    createdAt: daysAgo(10),
    expiresAt: daysAhead(50),
    renewedAt: null,
    dailyCap: 20,
    ...overrides,
  }
}

export function thread(overrides: Partial<MailThreadView> = {}): MailThreadView {
  const entries = overrides.entries ?? threeMessages()
  return {
    id: fixtureId('thread:stellplatz'),
    documentId: THREAD_DOCUMENT_ID,
    name: 'Stellplatznachweis',
    entryCount: entries.length,
    lastEntryAt: entries.at(-1)?.sentAt ?? null,
    followed: false,
    participantDomains: ['ma37.wien.gv.at', 'statik-weber.at', 'huber-architektur.at'],
    continuesThreadId: null,
    follows: [],
    managesFollows: false,
    waitingCount: 0,
    ...overrides,
    entries,
  }
}

export function versions(count: number): DocumentVersionView[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    return {
      id: fixtureId(`ver:thread:${number}`),
      documentId: THREAD_DOCUMENT_ID,
      versionNumber: number,
      state: number === count ? 'published' : 'superseded',
      contentType: 'text/markdown',
      fileSize: 2_400 * number,
      contentHash: null,
      submittedBy: null,
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      publishedBy: VIEWER_ID,
      publishedAt: daysAgo(count - number),
      reviewComment: null,
      createdBy: VIEWER_ID,
      createdAt: daysAgo(count - number),
      updatedAt: daysAgo(count - number),
    }
  })
}

function threeMessages(): MailThreadEntryView[] {
  return [
    entry({
      key: 'first',
      version: 1,
      senderName: 'Miriam Huber',
      senderDomain: 'huber-architektur.at',
      senderTrust: 'member_verified',
      sentAt: '2026-10-02T14:40:00.000Z',
    }),
    entry({
      key: 'statik',
      version: 2,
      senderName: 'DI Petra Weber',
      senderDomain: 'statik-weber.at',
      sentAt: '2026-10-09T09:05:00.000Z',
      receivedAt: '2026-10-09T09:07:00.000Z',
      attachments: [
        attachment({ position: 1, filename: 'S-101_B.pdf', disposition: 'filed' }),
        attachment({ position: 2, filename: 'Lastannahmen.xlsx', disposition: 'already_present' }),
        attachment({ position: 3, filename: 'Honorarnote_Okt.zip', disposition: 'not_filed', notFiledReason: 'archive', documentId: undefined, documentVersionId: undefined }),
        attachment({ position: 4, filename: null, disposition: 'filed', visible: false, documentId: undefined, documentVersionId: undefined }),
      ],
    }),
    entry({
      key: 'authority',
      version: 3,
      sentAt: '2026-10-14T07:12:00.000Z',
      attachments: [attachment({ position: 1, filename: 'Stellungnahme_MA37_Stellplatznachweis.pdf' })],
      filedVia: 'agent_proposal',
    }),
  ]
}

export const ENTRY_TEXTS: Readonly<Record<string, string>> = {
  [fixtureId('entry:first')]: 'Liebe Frau Weber, können Sie uns die Statik zum Stellplatznachweis bis Ende nächster Woche schicken? Lg Miriam Huber',
  [fixtureId('entry:statik')]: 'Anbei S-101 Index B und die Lastannahmen, die Honorarnote für Oktober liegt bei. Schöne Grüße, Petra Weber',
  [fixtureId('entry:authority')]: 'Der Stellplatznachweis ist vollständig. Die Stellungnahme der MA 37 liegt bei. Mit freundlichen Grüßen, Mag. Huber',
}

export interface MailThreadFixture {
  view: MailThreadView
  versions: DocumentVersionView[]
  others: MailThreadSummaryView[]
  people: ProjectPerson[]
  original: FetchedDownload
  detachRefusal?: string
  detachEntryId?: string
  focusEntryId?: string
  load?: 'loading' | 'error'
}

const OTHERS: MailThreadSummaryView[] = [
  { id: fixtureId('thread:fassade'), documentId: fixtureId('doc:fassade'), name: 'Fassadenmuster Hofseite', entryCount: 4, lastEntryAt: daysAgo(3), followed: false },
  { id: fixtureId('thread:brandschutz'), documentId: fixtureId('doc:brandschutz'), name: 'Brandschutzkonzept – Rückfragen MA 37', entryCount: 2, lastEntryAt: daysAgo(30), followed: true },
]

const PEOPLE: ProjectPerson[] = [
  { userId: VIEWER_ID, name: 'Miriam Huber', email: 'm.huber@huber-architektur.at' },
  { userId: 'user_01JLUKAS000000000000000000', name: 'Lukas Brandstätter', email: 'l.brandstaetter@huber-architektur.at' },
  { userId: 'user_01JSABINE00000000000000000', name: 'Sabine Gruber', email: 's.gruber@huber-architektur.at' },
]

function fixture(overrides: Partial<MailThreadFixture> & { view: MailThreadView }): MailThreadFixture {
  return { versions: versions(Math.max(...overrides.view.entries.map((e) => e.firstVersion?.number ?? 1), 1)), others: OTHERS, people: PEOPLE, original: { saved: true }, ...overrides }
}

function worstCase(): MailThreadView {
  const long = 'Rechtsanwaltskanzlei Dr. Maximiliane Österreicher-Habsburg-Lothringen und Partner:innen'
  const entries: MailThreadEntryView[] = Array.from({ length: 24 }, (_, index) =>
    entry({
      key: `worst-${index}`,
      version: index + 1,
      heading: `${String((index % 28) + 1).padStart(2, '0')}.09.2026 08:0${index % 10} · ${index % 3 === 0 ? long : index % 3 === 1 ? '李小龍 🏗️' : 'X'} (${index % 2 ? 'sub.domain.with.a.very.long.name.example' : 'a.at'})`,
      senderName: index % 3 === 0 ? long : 'X',
      signerDomain: index % 4 === 0 ? null : 'sub.domain.with.a.very.long.name.example',
      senderTrust: (['external_verified', 'external_unverified', 'member_unverified', 'not_checked'] as const)[index % 4],
      source: index % 4 === 3 ? 'archive' : 'inbound',
      original: index % 4 === 3 ? null : index % 5 === 0 ? { scanStatus: 'infected' } : index % 7 === 0 ? { scanStatus: 'pending' } : { scanStatus: 'clean' },
      filedVia: (['app', 'follow', 'agent', 'archive_import'] as const)[index % 4],
      attachments: index % 2
        ? Array.from({ length: 6 }, (_, position) =>
            attachment({
              position: position + 1,
              filename: position === 0 ? 'Einreichplan_Hofseite_Stellplätze_Variante_3_final_final_wirklich_final_INDEX_C_2026-10-14.pdf' : `Anhang_${position}_ohne_Leerzeichen_sehr_lang_${'x'.repeat(40)}.pdf`,
              disposition: (['filed', 'already_present', 'not_filed'] as const)[position % 3],
              notFiledReason: position % 3 === 2 ? 'type_not_accepted' : undefined,
              visible: position !== 5,
            }),
          )
        : [],
    }),
  )
  return thread({
    name: `Stellplatznachweis – ${long} – Nachreichung zum Bescheid MA 37 vom 14.10.2026`,
    entries,
    followed: true,
    follows: [
      follow({ userId: VIEWER_ID, createdAt: daysAgo(179.5), expiresAt: daysAhead(0.4) }),
      ...Array.from({ length: 9 }, (_, index) => follow({ userId: `user_01JOTHER${index}`, expiresAt: daysAhead(index * 9 + 1) })),
    ],
    managesFollows: true,
    waitingCount: 1_284,
  })
}

export const MAIL_THREAD_VARIANTS: Record<string, MailThreadFixture> = {
  'three-messages': fixture({ view: thread({ waitingCount: 2, followed: true, follows: [follow({ userId: VIEWER_ID })] }) }),
  'not-followed': fixture({ view: thread({ waitingCount: 2 }) }),
  'same-sender': fixture({
    view: thread({
      entries: [
        ...threeMessages().slice(0, 2),
        ...[3, 4].map((version) =>
          entry({
            key: `statik-${version}`,
            version,
            senderName: 'DI Petra Weber',
            senderDomain: 'statik-weber.at',
            sentAt: version === 3 ? '2026-10-10T06:35:00.000Z' : '2026-10-12T06:45:00.000Z',
          })
        ),
      ],
    }),
  }),
  followed: fixture({
    view: thread({ followed: true, follows: [follow({ userId: VIEWER_ID })], waitingCount: 0 }),
  }),
  'renew-limit': fixture({
    view: thread({ followed: true, follows: [follow({ userId: VIEWER_ID, createdAt: daysAgo(170), expiresAt: daysAhead(10) })] }),
  }),
  'manager-follows': fixture({
    view: thread({
      followed: true,
      follows: [follow({ userId: VIEWER_ID }), follow({ userId: PEOPLE[1].userId, expiresAt: daysAhead(12) }), follow({ userId: PEOPLE[2].userId, expiresAt: daysAhead(44) })],
      managesFollows: true,
    }),
  }),
  'member-sees-follows': fixture({
    view: thread({ follows: [follow({ userId: PEOPLE[1].userId }), follow({ userId: PEOPLE[2].userId })], managesFollows: false, waitingCount: null }),
  }),
  'unverified-section': fixture({
    view: thread({
      entries: [
        ...threeMessages().slice(0, 2),
        entry({
          key: 'unverified',
          version: 3,
          sentAt: '2026-10-15T05:58:00.000Z',
          heading: '15.10.2026 07:58 · Mag. Huber (ma37-wien.example, Domain nicht bestätigt)',
          senderDomain: 'ma37-wien.example',
          signerDomain: null,
          senderTrust: 'external_unverified',
        }),
      ],
    }),
  }),
  'direct-and-forwarded': fixture({
    view: thread({
      entries: [
        ...threeMessages().slice(0, 1),
        entry({
          key: 'direct',
          version: 2,
          sentAt: '2026-10-16T08:02:00.000Z',
          senderName: 'Miriam Huber',
          senderDomain: 'huber-architektur.at',
          signerDomain: 'huber-architektur.at',
          senderTrust: 'member_verified',
          filedVia: 'sender',
        }),
        entry({
          key: 'forwarded',
          version: 3,
          sentAt: '2026-10-20T12:02:00.000Z',
          heading: '20.10.2026 14:02 · MA 37 – Baupolizei (ma37.wien.gv.at, Domain nicht bestätigt)',
          senderName: 'Miriam Huber',
          senderDomain: 'huber-architektur.at',
          signerDomain: 'huber-architektur.at',
          senderTrust: 'member_verified',
          forwardedBy: { name: 'Miriam Huber', domain: 'huber-architektur.at' },
          filedVia: 'sender',
        }),
      ],
    }),
  }),
  'archive-sections': fixture({
    view: thread({
      entries: threeMessages().map((item) => ({ ...item, source: 'archive', senderTrust: 'not_checked', original: null, filedVia: 'archive_import', signerDomain: null })),
    }),
  }),
  'original-infected': fixture({
    view: thread({ entries: threeMessages().map((item, index) => (index === 2 ? { ...item, original: { scanStatus: 'infected' } } : item)) }),
  }),
  'original-refused': fixture({ view: thread(), original: { saved: false, status: 409, reason: 'original_not_clean' } }),
  'detach-confirm': fixture({ view: thread({ followed: true, follows: [follow({ userId: VIEWER_ID })] }), detachEntryId: fixtureId('entry:statik') }),
  'detach-refused': fixture({ view: thread(), detachEntryId: fixtureId('entry:statik'), detachRefusal: 'name_taken' }),
  focused: fixture({ view: thread(), focusEntryId: fixtureId('entry:first') }),
  loading: fixture({ view: thread(), load: 'loading' }),
  error: fixture({ view: thread(), load: 'error' }),
  'worst-case': fixture({ view: worstCase(), versions: versions(24) }),
}

export function origin(overrides: Partial<MailOriginView> = {}): MailOriginView {
  return {
    threadId: fixtureId('thread:stellplatz'),
    entryId: fixtureId('entry:statik'),
    sentAt: '2026-10-09T09:05:00.000Z',
    receivedAt: '2026-10-09T09:07:00.000Z',
    fromName: 'DI Petra Weber',
    forwardedByName: null,
    forwarded: false,
    signerDomain: 'statik-weber.at',
    senderTrust: 'external_verified',
    ...overrides,
  }
}

export const PROVENANCE_ORIGINS: Record<string, MailOriginView[]> = {
  verified: [origin()],
  unverified: [origin({ fromName: 'Mag. Huber', signerDomain: null, senderTrust: 'external_unverified' })],
  archive: [origin({ fromName: 'Statik Weber Büro', signerDomain: null, senderTrust: 'not_checked' })],
  anonymous: [origin({ fromName: null })],
  forwarded: [origin({ fromName: 'MA 37 – Baupolizei', forwardedByName: 'Miriam Huber', forwarded: true, signerDomain: 'huber-architektur.at', senderTrust: 'member_verified' })],
  several: [origin(), origin({ entryId: fixtureId('entry:authority'), fromName: 'Mag. Huber', signerDomain: 'ma37.wien.gv.at' })],
  worst: [
    origin({
      fromName: 'Rechtsanwaltskanzlei Dr. Maximiliane Österreicher-Habsburg-Lothringen und Partner:innen 🏛️',
      signerDomain: 'sub.domain.with.a.very.long.name.that.never.breaks.example',
    }),
    origin(),
    origin(),
  ],
}

export function fixtureMailThreadClient(fixture: MailThreadFixture): MailThreadClient {
  let view = fixture.view
  const pending = new Promise<never>(() => {})
  const summary = (): MailThreadSummaryView => ({
    id: view.id,
    documentId: view.documentId,
    name: view.name,
    entryCount: view.entries.length,
    lastEntryAt: view.lastEntryAt,
    followed: view.followed,
  })
  return {
    ofDocument: async () => summary(),
    get: async () => {
      if (fixture.load === 'loading') return pending
      if (fixture.load === 'error') throw new ApiRequestError('Failed to load the mail thread', 500)
      return view
    },
    list: async () => ({ items: [summary(), ...fixture.others], nextCursor: null }),
    follow: async () => {
      const own = view.follows.find((item) => item.userId === VIEWER_ID)
      const next = own ? { ...own, expiresAt: daysAhead(60), renewedAt: at(0) } : follow({ userId: VIEWER_ID, createdAt: at(0), expiresAt: daysAhead(60) })
      view = { ...view, followed: true, follows: [...view.follows.filter((item) => item.userId !== VIEWER_ID), next] }
      return { follow: next, renewed: own !== undefined }
    },
    unfollow: async (_projectId, _threadId, options = {}) => {
      const userId = options.userId ?? VIEWER_ID
      const ended = view.follows.find((item) => item.userId === userId) ?? null
      view = { ...view, followed: userId === VIEWER_ID ? false : view.followed, follows: view.follows.filter((item) => item.userId !== userId) }
      return { endedFollowId: ended?.id ?? null }
    },
    detach: async (_projectId, threadId, entryId, body) => {
      if (fixture.detachRefusal) throw new ApiRequestError('Refused', 409, fixture.detachRefusal)
      const followsEnded = view.follows.length
      view = { ...view, entries: view.entries.filter((item) => item.id !== entryId), follows: [], followed: false }
      const to = body.target.action === 'append' ? body.target.mailThreadId : fixtureId('thread:new')
      return {
        entryId,
        from: { threadId, documentId: view.documentId, versionId: fixtureId('ver:after-detach') },
        to: { threadId: to, documentId: fixtureId(`doc:${to}`), versionId: fixtureId('ver:joined') },
        followsEnded,
      }
    },
    downloadOriginal: async () => fixture.original,
    versions: async () => ({ documentId: view.documentId, lifecycle: 'active', publishedVersionId: fixture.versions.at(-1)?.id ?? null, versions: fixture.versions }),
    diff: async (_documentId, from, to) => {
      const version = (id: string): DocumentVersionView => fixture.versions.find((item) => item.id === id) ?? fixture.versions[0]
      return {
        from: { version: version(from), content: '## 02.10.2026 16:40 · Miriam Huber (huber-architektur.at)\n\nKönnen Sie uns die Statik zum Stellplatznachweis schicken?\n\n## 09.10.2026 11:05 · DI Petra Weber (statik-weber.at)\n\nAnbei S-101 Index B und die Lastannahmen.' },
        to: {
          version: version(to),
          content:
            '## 02.10.2026 16:40 · Miriam Huber (huber-architektur.at)\n\nKönnen Sie uns die Statik zum Stellplatznachweis schicken?\n\n## 09.10.2026 11:05 · DI Petra Weber (statik-weber.at)\n\nAnbei S-101 Index B und die Lastannahmen.\n\n## 14.10.2026 09:12 · Mag. Huber (ma37.wien.gv.at)\n\nDer Stellplatznachweis ist vollständig.',
        },
      }
    },
    people: async () => fixture.people,
  }
}
