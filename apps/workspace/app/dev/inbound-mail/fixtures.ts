/**
 * Fixtures of the E-Mail-Eingang, typed from the wire (`inbound-mail-wire.ts`),
 * for the `/dev/inbound-mail*` previews and the component specs: one per state
 * DECISION §9 names, each built from the same few builders so a change to the
 * wire breaks them at compile time, not on screen.
 *
 * What a mail asks of the person (each part's `preselected`, the sender's
 * risk, `incompleteReason`) is never written by hand here: `mail()` derives it
 * with the server's own rule (`withReviewDefaults`), so a preview shows what
 * the route would answer.
 *
 * `fixtureClient` serves them behind the same interface the components take
 * (`InboundMailClient`), so a preview renders the real organism over data
 * that stands still. Filing in a preview „works“: the parts go to `filing`,
 * and the next read answers them `filed`.
 */

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
import { mail, messagePart, summaryOf, text } from './fixture-builders'

export { FIXTURE_NOW, fixtureId, FOLDERS, PROJECT_ID, PROJECT_NAME } from './fixture-base'
export { mail, messagePart, part, summaryOf, text, thread } from './fixture-builders'
export { DETAIL_VARIANTS, type DetailFixture } from './detail-variants'

/** The first page of a list variant. */
export interface ListFixture {
  items: InboundMailSummaryView[]
  nextCursor?: string | null
  closed?: boolean
  /** Mails checked on arrival. */
  checked?: string[]
  /** The open mail. */
  open?: string
  status?: 'waiting' | 'handled'
  outcome?: 'filed' | 'dismissed' | 'expired' | null
  load?: 'loading' | 'error'
  /** For the empty variants: whether the project ever received mail. */
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

/**
 * The list as the owner's scene has it (WOW §1): three mails ready to file as
 * suggested (the Statik's new Fassung and Miriam's forwarded Bescheid continue
 * „Stellplatznachweis“, the MA 37's statement continues its own Verlauf), and
 * four that need a person, each for its own reason: six attachments to look
 * at, a reply whose Verlauf the sender cannot vouch for, a mail posing as
 * Miriam, a name the name check stopped. Two quiet ones at the end.
 */
const allMails = [
  v('member-verified'),
  v('revision'),
  v('authority-statement'),
  v('mixed-attachments'),
  v('unverified-thread'),
  v('impersonation'),
  v('name-stop'),
  ...quietMails,
]

/** Twenty-four replies to one Verlauf, more than one request may decide (the worst-case list). */
const bulkMails = Array.from({ length: 24 }, (_, index) =>
  mail({ key: `bulk-${index}`, subject: index % 2 ? null : `RE: ${'Sehr langer Betreff '.repeat(index % 5)}`, receivedAt: minutesAgo(60 * index) })
)

/**
 * Each mail by id, the FIRST fixture of an id winning: later variants reuse a
 * mail's view (a filed or followed state of it) with the default text, and the
 * list's detail must show the mail's own text, not the Statik mail's.
 */
export const DETAIL_BY_ID = new Map<string, DetailFixture>()
for (const fixture of [
  ...Object.values(DETAIL_VARIANTS),
  ...[...groupMails, ...quietMails, ...bulkMails].map((view) => ({ view, text: text() })),
]) {
  if (!DETAIL_BY_ID.has(fixture.view.id)) DETAIL_BY_ID.set(fixture.view.id, fixture)
}

/** A page of the list as the route answers it: the thread groups are the server's (`threadGroupsOf`). */
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
  many: { items: allMails.map((view) => summaryOf(view)), nextCursor: 'more', open: v('member-verified').id },
  // One conversation, split: three ready replies go in one press, two that need a look are gone through in order.
  'thread-group': { items: [...groupMails.map((view) => summaryOf(view)), summaryOf(v('mixed-attachments')), summaryOf(v('name-stop'))] },
  'unverified-group': { items: [summaryOf(v('member-verified')), ...quietMails.map((view) => summaryOf(view))] },
  selected: { items: [...groupMails.map((view) => summaryOf(view)), summaryOf(v('revision'))], checked: [groupMails[0].id, groupMails[1].id] },
  // A member's mail addressed to others needs its sender confirmed, which a bulk request never carries.
  // (An impersonation cannot be selected at all: `bulkSelectable`.)
  'bulk-blocked': { items: [...allMails, v('not-addressed')].map((view) => summaryOf(view)), checked: [v('member-verified').id, v('not-addressed').id] },
  settled: { status: 'handled', items: [summaryOf(v('filed-outcome')), summaryOf(v('decided-by-other')), summaryOf(v('expired')), summaryOf(v('dismissed'))] },
  dismissed: { status: 'handled', outcome: 'dismissed', items: [summaryOf(v('dismissed'))] },
  expired: { status: 'handled', outcome: 'expired', items: [summaryOf(v('expired'))] },
  closed: { closed: true, items: [summaryOf(v('closed')), summaryOf(v('member-verified'))], open: v('closed').id },
  followed: { items: [summaryOf(v('followed')), summaryOf(v('revision'))] },
  'worst-case': {
    items: [summaryOf(v('worst-case')), ...bulkMails.map((view, index) => summaryOf(view, { attachments: index * 11, senderName: index % 4 ? null : 'Jo' }))],
    nextCursor: 'more',
    open: v('worst-case').id,
  },
}

// ------------------------------------------------------------ the address

export type AddressFixture = InboundMailAddressView | 'loading' | 'error'

const activeAddress: InboundMailAddressView = {
  state: 'active',
  address: 'bauplatz-12.k3x7q2m9p4ab@example.org',
  canManage: true,
  lastReceivedAt: minutesAgo(12),
  droppedLast30Days: 0,
  ownDomainVerifiedShare: 0.94,
}

export const ADDRESS_VARIANTS: Record<string, AddressFixture> = {
  manager: activeAddress,
  member: { ...activeAddress, canManage: false },
  off: { ...activeAddress, state: 'none', address: null, lastReceivedAt: null, ownDomainVerifiedShare: null },
  'off-member': { ...activeAddress, state: 'none', address: null, canManage: false, lastReceivedAt: null, ownDomainVerifiedShare: null },
  unavailable: { ...activeAddress, state: 'unavailable', address: null, canManage: false, lastReceivedAt: null, ownDomainVerifiedShare: null },
  'long-address': {
    ...activeAddress,
    address: 'stellplatznachweis-tiefgarage-ebene-2-wohnbau-seestadt-nord.k3x7q2m9p4ab@example.org',
  },
  loading: 'loading',
  error: 'error',
  refusals: { ...activeAddress, droppedLast30Days: 17, lastReceivedAt: minutesAgo(60 * 24 * 3) },
  'own-dkim-missing': { ...activeAddress, ownDomainVerifiedShare: 0 },
}

// ------------------------------------------------------------ clients

const pending = <T,>(): Promise<T> => new Promise<T>(() => {})
const failing = <T,>(): Promise<T> => Promise.reject(new Error('fixture: refused'))

/** A client over the fixtures: reads answer at once, decisions change the fixture in memory. */
/** Where a decided part will have gone once the fixture's filing settles: what the server's `filedAs` would say. */
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
  // Every change is judged again by the server's rule, as the route's answer would be.
  const settle = (view: InboundMailView): InboundMailView =>
    withReviewDefaults({
      ...view,
      parts: view.parts.map((candidate) => (candidate.state === 'filing' ? { ...candidate, state: 'filed', documentId: candidate.documentId ?? fixtureId(`doc:${candidate.id}`) } : candidate)),
    })
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
    dismiss: (_projectId, body) =>
      Promise.resolve({
        mails: body.mailIds.map((id) => {
          const view = views.get(id) as InboundMailView
          const next = withReviewDefaults({
            ...view,
            status: 'handled',
            parts: view.parts.map((candidate) => (candidate.state === 'waiting' ? { ...candidate, state: 'dismissed' as const, restorableUntil: daysAhead(7) } : candidate)),
          })
          views.set(id, next)
          return next
        }),
      }),
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
    // No bytes in a preview: the thumbnails stand as their tiles.
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
      if (typeof current === 'object') current = { ...current, address: 'bauplatz-12.w8n2c4r7t1qz@example.org' }
      return answer()
    },
    remove: () => {
      if (typeof current === 'object') current = { ...current, state: 'none', address: null }
      return answer()
    },
  }
}
