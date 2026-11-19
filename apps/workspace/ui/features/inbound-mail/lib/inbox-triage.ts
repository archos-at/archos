import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'

export function nextOpenAfter(decidedId: string, before: readonly Pick<InboundMailSummaryView, 'id'>[], after: readonly Pick<InboundMailSummaryView, 'id'>[]): string | null {
  const still = new Set(after.map((mail) => mail.id))
  const index = before.findIndex((mail) => mail.id === decidedId)
  if (index < 0) return after[0]?.id ?? null
  const below = before.slice(index + 1).find((mail) => still.has(mail.id))
  if (below) return below.id
  const above = before.slice(0, index).reverse().find((mail) => still.has(mail.id))
  return above?.id ?? after.find((mail) => mail.id !== decidedId)?.id ?? null
}

export function wasDecided(mailId: string, before: readonly Pick<InboundMailSummaryView, 'id'>[], after: readonly Pick<InboundMailSummaryView, 'id' | 'status'>[]): boolean {
  if (!before.some((mail) => mail.id === mailId)) return false
  return !after.some((mail) => mail.id === mailId && mail.status === 'waiting')
}

export function dismissErases(mail: Pick<InboundMailSummaryView, 'senderTrust' | 'senderFlags' | 'onlySenderReleases'>): boolean {
  return !mail.onlySenderReleases && mail.senderTrust === 'external_unverified' && !mail.senderFlags.includes('sender_unchecked')
}

const CONTROL = [
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="slider"]',
].join(', ')

export function dismissKeyAllowed(target: EventTarget | null, root: Element | null, openId: string | null): boolean {
  if (!(target instanceof Element) || !root) return false
  if (target === document.body || target === document.documentElement) return true
  if (!root.contains(target)) return false
  if (target.closest(CONTROL)) return false
  const link = target.closest('a')
  if (!link) return true
  const row = link.closest('[data-mail-id]')
  return row !== null && row.getAttribute('data-mail-id') === openId && link.matches('[data-testid="inbound-mail-row-link"]')
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('de')

export function matchesQuery(mail: Pick<InboundMailSummaryView, 'subject' | 'senderName' | 'senderDomain'>, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold([mail.subject, mail.senderName, mail.senderDomain].filter(Boolean).join(' '))
  return words.every((word) => haystack.includes(word))
}
