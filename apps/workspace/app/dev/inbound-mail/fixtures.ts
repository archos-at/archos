import type {
  InboundMailAddressView,
  InboundMailDecision,
  InboundMailFiledAsView,
  InboundMailListView,
  InboundMailSummaryView,
  InboundMailTextView,
  InboundMailView,
} from '@/lib/inbound-mail/inbound-mail-wire'
import { withReviewDefaults } from '@/lib/inbound-mail/review-defaults'
import { threadGroupsOf } from '@/lib/inbound-mail/thread-groups'
import type { InboundMailAddressClient, InboundMailClient } from '@/features/inbound-mail/lib/client'
import { daysAhead, fixtureId, FOLDERS, minutesAgo } from './fixture-base'
import { DETAIL_VARIANTS, type DetailFixture } from './detail-variants'
import { mail, messagePart, part, summaryOf, text } from './fixture-builders'

export { FIXTURE_NOW, fixtureId, FOLDERS, PROJECT_ID, PROJECT_NAME } from './fixture-base'
export { mail, messagePart, part, summaryOf, text, thread } from './fixture-builders'
export { DETAIL_VARIANTS, type DetailFixture } from './detail-variants'

export interface ListFixture {
  items: InboundMailSummaryView[]
  nextCursor?: string | null
  closed?: boolean
  checked?: string[]
  open?: string
  status?: 'waiting' | 'handled'
  outcome?: 'filed' | 'dismissed' | 'expired' | null
  load?: 'loading' | 'error'
  everReceived?: boolean
}

const v = (name: string): InboundMailView => DETAIL_VARIANTS[name].view

const groupMails = [0, 1, 2].map((index) =>
  mail({
    key: `group-${index}`,
    subject: index === 0 ? 'AW: Stellplatznachweis' : `AW: AW: Stellplatznachweis (${index})`,
    receivedAt: minutesAgo(20 + index * 7),
    parts: [messagePart({ id: fixtureId(`message:group-${index}`) })],
  })
)

const quietMails = [
  mail({ key: 'quiet-1', subject: 'Newsletter Oktober', automatic: true, threadCandidates: [], sender: { name: 'Baustoffe Direkt', address: 'news@baustoffe.example', domain: 'baustoffe.example', signerDomain: 'baustoffe.example', trust: 'external_verified', reason: 'dkim_pass', flags: [] } }),
  DETAIL_VARIANTS['external-unverified'].view,
]

const expiringMail = mail({
  key: 'outsider-expiring',
  subject: 'Rückfrage Gerüststellung Hofseite',
  sender: { name: 'Gerüstbau Novak', address: 'office@geruestbau-novak.example', domain: 'geruestbau-novak.example', signerDomain: null, trust: 'external_unverified', reason: 'dkim_none', flags: [] },
  receivedAt: minutesAgo(60 * 24 * 12),
  sentAt: minutesAgo(60 * 24 * 12 + 3),
  expiresAt: daysAhead(2),
  parts: [messagePart({ id: fixtureId('message:outsider-expiring') }), part({ name: 'Geruestplan_Hof.pdf' })],
  threadCandidates: [],
})

const allMails = [
  v('member-verified'),
  v('revision'),
  v('authority-statement'),
  v('mixed-attachments'),
  v('unverified-thread'),
  v('impersonation-colleague'),
  v('name-stop'),
  expiringMail,
  ...quietMails,
]

const bulkMails = Array.from({ length: 24 }, (_, index) =>
  mail({ key: `bulk-${index}`, subject: index % 2 ? null : `RE: ${'Sehr langer Betreff '.repeat(index % 5)}`, receivedAt: minutesAgo(60 * index) })
)

export const DETAIL_BY_ID = new Map<string, DetailFixture>()
for (const fixture of [
  ...Object.values(DETAIL_VARIANTS),
  ...[...groupMails, ...quietMails, expiringMail, ...bulkMails].map((view) => ({ view, text: text() })),
]) {
  if (!DETAIL_BY_ID.has(fixture.view.id)) DETAIL_BY_ID.set(fixture.view.id, fixture)
}

export function listPage(items: InboundMailSummaryView[], nextCursor: string | null = null): InboundMailListView {
  const sentAt = (id: string): string | null => DETAIL_BY_ID.get(id)?.view.sentAt ?? null
  return {
    items,
    threadGroups: threadGroupsOf(items.map((summary) => ({ summary, order: { id: summary.id, sentAt: sentAt(summary.id), receivedAt: summary.receivedAt } }))),
    nextCursor,
  }
}

export const LIST_VARIANTS: Record<string, ListFixture> = {
  empty: { items: [], everReceived: false },
  done: { items: [], everReceived: true },
  loading: { items: [], load: 'loading' },
  error: { items: [], load: 'error' },
  one: { items: [summaryOf(v('member-verified'))] },
  many: { items: allMails.map((view) => summaryOf(view)), open: v('member-verified').id },
  'thread-group': { items: [...groupMails.map((view) => summaryOf(view)), summaryOf(v('mixed-attachments')), summaryOf(v('name-stop'))] },
  'unverified-group': { items: [summaryOf(v('member-verified')), summaryOf(expiringMail), ...quietMails.map((view) => summaryOf(view))] },
  'only-automatic': { items: [summaryOf(quietMails[0])] },
  selected: { items: [...groupMails.map((view) => summaryOf(view)), summaryOf(v('revision'))], checked: [groupMails[0].id, groupMails[1].id] },
  'bulk-blocked': { items: [...allMails, v('not-addressed')].map((view) => summaryOf(view)), checked: [v('member-verified').id, v('not-addressed').id] },
  settled: { status: 'handled', items: [summaryOf(v('filed-outcome')), summaryOf(v('decided-by-other')), summaryOf(v('expired')), summaryOf(v('dismissed'))] },
  dismissed: { status: 'handled', outcome: 'dismissed', items: [summaryOf(v('dismissed'))] },
  expired: { status: 'handled', outcome: 'expired', items: [summaryOf(v('expired'))] },
  closed: { closed: true, items: [summaryOf(v('closed')), summaryOf(v('member-verified'))], open: v('closed').id },
  followed: { items: [summaryOf(v('followed')), summaryOf(v('revision'))] },
  claimed: {
    items: [v('member-verified'), v('not-filed'), v('paused'), v('impersonation-colleague'), v('claimed-by-colleague'), v('external-unverified')].map((view) => summaryOf(view)),
    open: v('claimed-by-colleague').id,
  },
  own: {
    items: [v('revision'), v('own-unverified'), v('bcc-own'), v('automatic-own'), v('impersonation')].map((view) => summaryOf(view)),
    open: v('own-unverified').id,
  },
  'worst-case': {
    items: [summaryOf(v('worst-case')), ...bulkMails.map((view, index) => summaryOf(view, { attachments: index * 11, senderName: index % 4 ? null : 'Jo' }))],
    nextCursor: 'more',
    open: v('worst-case').id,
  },
}

export type AddressFixture = InboundMailAddressView | 'loading' | 'error'

const activeAddress: InboundMailAddressView = {
  state: 'active',
  address: 'project+bauplatz-12-wohnbau-seestadt.k3x7q2m5p4ab@inbox.example.org',
  canManage: true,
  lastReceivedAt: minutesAgo(12),
  droppedLast30Days: 0,
  ownDomainVerifiedShare: 0.94,
  forwardedFrom: [],
}

export const ADDRESS_VARIANTS: Record<string, AddressFixture> = {
  manager: activeAddress,
  member: { ...activeAddress, canManage: false },
  off: { ...activeAddress, state: 'none', address: null, lastReceivedAt: null, ownDomainVerifiedShare: null },
  'off-member': { ...activeAddress, state: 'none', address: null, canManage: false, lastReceivedAt: null, ownDomainVerifiedShare: null },
  unavailable: { ...activeAddress, state: 'unavailable', address: null, canManage: false, lastReceivedAt: null, ownDomainVerifiedShare: null },
  'long-address': {
    ...activeAddress,
    address: 'projektpost-wien-seestadt+stellplatznachweis-tiefgarage.k3x7q2m5p4ab@posteingang.example.org',
  },
  loading: 'loading',
  error: 'error',
  refusals: { ...activeAddress, droppedLast30Days: 17, lastReceivedAt: minutesAgo(60 * 24 * 3) },
  'own-dkim-missing': { ...activeAddress, ownDomainVerifiedShare: 0 },
  forwards: { ...activeAddress, forwardedFrom: ['bauplatz12@huber-architektur.at', 'seestadt-wohnbau@huber-architektur.at'] },
  'forwards-member': { ...activeAddress, canManage: false, forwardedFrom: ['bauplatz12@huber-architektur.at'] },
}

const pending = <T,>(): Promise<T> => new Promise<T>(() => {})
const failing = <T,>(): Promise<T> => Promise.reject(new Error('fixture: refused'))

function filedAsOf(view: InboundMailView, decision: InboundMailDecision, partId: string): InboundMailFiledAsView | null {
  const message = decision.message
  if (message?.partId === partId) {
    if (message.thread.action === 'append') {
      const threadId = message.thread.mailThreadId
      const candidate = view.threadCandidates.find((entry) => entry.threadId === threadId)
      return candidate ? { name: candidate.name, folderPath: candidate.folderPath, version: candidate.nextVersion } : null
    }
    const folder = FOLDERS.find((entry) => entry.id === (message.thread as { folderId: string | null }).folderId)
    return { name: message.thread.name, folderPath: folder?.path ?? message.thread.newFolderPath ?? null, version: 1 }
  }
  const choice = decision.parts.find((entry) => entry.partId === partId)
  if (!choice) return null
  const revision = view.parts.find((entry) => entry.id === partId)?.revisionCandidate
  if (choice.revisionOf && revision) return { name: revision.name, folderPath: revision.folderPath, version: revision.nextVersion }
  const folder = FOLDERS.find((entry) => entry.id === choice.folderId)
  return { name: choice.name, folderPath: folder?.path ?? choice.newFolderPath ?? null, version: 1 }
}

export function fixtureClient(options: { list?: ListFixture; detail?: DetailFixture } = {}): InboundMailClient {
  const views = new Map<string, InboundMailView>()
  for (const [id, fixture] of DETAIL_BY_ID) views.set(id, fixture.view)
  if (options.detail) views.set(options.detail.view.id, options.detail.view)
  const texts = (id: string): InboundMailTextView => DETAIL_BY_ID.get(id)?.text ?? options.detail?.text ?? text()
  const settle = (view: InboundMailView): InboundMailView =>
    withReviewDefaults({
      ...view,
      parts: view.parts.map((candidate) => (candidate.state === 'filing' ? { ...candidate, state: 'filed', documentId: candidate.documentId ?? fixtureId(`doc:${candidate.id}`) } : candidate)),
    })
  const dismissed = (id: string): InboundMailView => {
    const view = views.get(id) as InboundMailView
    const next = withReviewDefaults({
      ...view,
      status: 'handled',
      parts: view.parts.map((candidate) => (candidate.state === 'waiting' ? { ...candidate, state: 'dismissed' as const, restorableUntil: daysAhead(7) } : candidate)),
    })
    views.set(id, next)
    return next
  }
  return {
    list: (_projectId, query = {}) => {
      if (options.list?.load === 'loading') return pending()
      if (options.list?.load === 'error') return failing()
      const status = query.status ?? 'waiting'
      const items = (options.list?.items ?? []).filter((item) => status === item.status)
      const page = listPage(items, query.cursor ? null : (options.list?.nextCursor ?? null))
      return Promise.resolve(status === 'waiting' ? page : { ...page, threadGroups: [] })
    },
    get: (_projectId, mailId) => {
      if (options.detail?.load === 'loading') return pending()
      if (options.detail?.load === 'error') return failing()
      const view = views.get(mailId)
      if (!view) return failing()
      const settled = settle(view)
      views.set(mailId, settled)
      return Promise.resolve(view)
    },
    text: (_projectId, mailId) => (options.detail?.load ? pending() : Promise.resolve(texts(mailId))),
    file: (_projectId, body) => {
      const mails = body.mails.map((decision) => {
        const view = views.get(decision.mailId) as InboundMailView
        const filed = new Set([...decision.parts.map((candidate) => candidate.partId), ...(decision.message ? [decision.message.partId] : [])])
        const next = withReviewDefaults({
          ...view,
          ifMatch: `${view.ifMatch}+`,
          parts: view.parts.map((candidate) =>
            candidate.state !== 'waiting'
              ? candidate
              : filed.has(candidate.id)
                ? { ...candidate, state: 'filing' as const, filedAs: filedAsOf(view, decision, candidate.id) }
                : { ...candidate, state: 'dismissed' as const, restorableUntil: daysAhead(7) }
          ),
        })
        views.set(view.id, next)
        return next
      })
      return Promise.resolve({ mails, filingJobId: 'job-fixture' })
    },
    dismiss: (_projectId, body) => Promise.resolve({ mails: body.mailIds.map(dismissed) }),
    report: (_projectId, mailId) => Promise.resolve({ mail: dismissed(mailId), warned: 3 }),
    restore: (_projectId, mailId) => {
      const view = views.get(mailId) as InboundMailView
      const next = withReviewDefaults({
        ...view,
        status: 'waiting',
        parts: view.parts.map((candidate) => (candidate.state === 'dismissed' || candidate.state === 'expired' ? { ...candidate, state: 'waiting' as const, restorableUntil: null } : candidate)),
      })
      views.set(mailId, next)
      return Promise.resolve(next)
    },
    follow: () => Promise.resolve(),
    unfollow: () => Promise.resolve(),
    threadOfDocument: (_projectId, documentId) =>
      Promise.resolve({ id: fixtureId(`thread-of:${documentId}`), documentId, name: 'Stellplatznachweis', entryCount: 3, lastEntryAt: minutesAgo(9), followed: false }),
    partContentUrl: () => '',
    originalUrl: () => '',
  }
}

export function fixtureAddressClient(fixture: AddressFixture): InboundMailAddressClient {
  let current = fixture
  const answer = (): Promise<InboundMailAddressView> =>
    current === 'loading' ? pending() : current === 'error' ? failing() : Promise.resolve(current)
  return {
    get: answer,
    create: () => {
      current = activeAddress
      return answer()
    },
    rotate: () => {
      if (typeof current === 'object') current = { ...current, address: 'project+bauplatz-12-wohnbau-seestadt.w6n2c4r7t3qz@inbox.example.org' }
      return answer()
    },
    remove: () => {
      if (typeof current === 'object') current = { ...current, state: 'none', address: null }
      return answer()
    },
    setForwardedFrom: (_projectId, forwardedFrom) => {
      if (typeof current === 'object') current = { ...current, forwardedFrom: [...forwardedFrom] }
      return answer()
    },
  }
}
