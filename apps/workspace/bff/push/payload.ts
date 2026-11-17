import { createHash } from 'node:crypto'
import { namespaceRoot, translatorFor } from '@/i18n/namespace'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { notificationsCopy } from '@/i18n/namespaces/notifications'
import type { Locale } from '@/i18n/config'
import { getByPath } from '@/i18n/translate'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import type { PushPreferences } from '@/lib/inbox/push-categories'
import type { InboxPushFold } from '@/lib/inbox/registry'
import { inboxTypePresentation, UNKNOWN_TYPE_PRESENTATION, type InboxItemView } from '@/lib/inbox/types'
import { isSameOriginPath } from '@/lib/utils/same-origin-path'

export const PUSH_PAYLOAD_VERSION = 1
const MAX_TITLE = 120
const MAX_BODY = 140

export interface PushMessage {
  version: typeof PUSH_PAYLOAD_VERSION
  title: string
  body: string | null
  url: string
  tag: string
  itemId: string
}

export function pushTagFor(groupKey: string): string {
  return createHash('sha256').update(groupKey).digest('base64url').slice(0, 32)
}

function clip(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > max ? `${single.slice(0, max - 1).trimEnd()}…` : single
}

export const INBOX_PATH = '/app/inbox'

export function buildFoldedPushMessage(
  items: readonly InboxItemView[],
  fold: InboxPushFold,
  preferences: PushPreferences,
  locale: Locale
): PushMessage | null {
  const told = items.filter((item) => item.href && isSameOriginPath(item.href))
  const type = told[0]?.type
  if (!type || told.length < 2) return null
  const tag = pushTagFor(`fold:${type}:${told[0]?.id}`)
  const base = { version: PUSH_PAYLOAD_VERSION, url: INBOX_PATH, tag, itemId: '' } as const
  if (!preferences.showContent) {
    return { ...base, title: translatorFor(notificationsCopy, locale)('push.genericTitle'), body: null }
  }
  const presentation = inboxTypePresentation(type) ?? UNKNOWN_TYPE_PRESENTATION
  const root = `inbox.types.${presentation.i18nKey}.pushFold`
  const t = translatorFor(collaborationCopy, locale)
  const words = getByPath(namespaceRoot(collaborationCopy, locale), `collaboration.${root}`) as { parts?: Record<string, unknown> } | undefined
  if (!words?.parts) return null
  const counts = new Map<string, number>()
  for (const item of told) {
    const part = (item.variant && fold.parts[item.variant]) || 'other'
    counts.set(part, (counts.get(part) ?? 0) + 1)
  }
  const line = Object.keys(words.parts)
    .filter((part) => counts.has(part))
    .map((part) => t(`${root}.parts.${part}`, { count: counts.get(part) ?? 0 }))
    .join(', ')
  return { ...base, title: clip(t(`${root}.title`, { count: told.length }), MAX_TITLE), body: clip(line, MAX_BODY) }
}

export function buildPushMessage(
  item: InboxItemView,
  groupKey: string,
  preferences: PushPreferences,
  locale: Locale
): PushMessage | null {
  if (!item.href || !isSameOriginPath(item.href)) return null
  const base = { version: PUSH_PAYLOAD_VERSION, url: item.href, tag: pushTagFor(groupKey), itemId: item.id } as const
  if (!preferences.showContent) {
    const t = translatorFor(notificationsCopy, locale)
    return { ...base, title: t('push.genericTitle'), body: null }
  }
  const { title, body } = inboxItemCopy(item, translatorFor(collaborationCopy, locale), namespaceRoot(collaborationCopy, locale), locale)
  return { ...base, title: clip(title, MAX_TITLE), body: body ? clip(body, MAX_BODY) : null }
}
