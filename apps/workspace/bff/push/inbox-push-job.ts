import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import { resolvePinnedRequesterSessionStrict } from '@/lib/auth/pinned-session'
import type { Locale } from '@/i18n/config'
import { resolvePushPreferences } from '@/lib/inbox/push-categories'
import { isPushStillDue, isPushWanted, pushCategoryOf, pushPolicyFor, PUSH_TTL_SECONDS } from '@/lib/inbox/push-policy'
import { findInboxItemForRecipient } from '@/lib/inbox/repository'
import { viewInboxItemAs } from '@/lib/inbox/service'
import type { JobAttempt } from '@/lib/jobs-queue/types'
import { findUserPreferences } from '@/lib/user-preferences/repository'
import { webPushConfig } from './config'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboxItem } from '@/lib/db/schema/inbox'
import type { PushPreferences } from '@/lib/inbox/push-categories'
import type { InboxItemView } from '@/lib/inbox/types'
import { readBurst } from './fold'
import { buildFoldedPushMessage, buildPushMessage } from './payload'
import {
  deleteAllSubscriptionsOf,
  deleteSubscriptionById,
  listSubscriptions,
  recordDelivered,
  recordFailure,
} from './repository'
import { createWebPushSender, type PushSender, type PushSendOutcome } from './sender'

export const MAX_CONSECUTIVE_FAILURES = 5

export interface InboxPushPayload {
  itemId: string
  recipientUserId: string
  stamp: string
}

export type InboxPushResult =
  | { sent: false; reason: string }
  | { sent: true; delivered: number; gone: number; rejected: number; transient: number }

function localeOf(prefs: Record<string, unknown> | null): Locale {
  return prefs?.locale === 'en' ? 'en' : 'de'
}

interface Tally {
  delivered: number
  gone: number
  rejected: number
  transient: number
}

async function settle(
  id: string,
  outcome: PushSendOutcome,
  attempt: JobAttempt,
  tally: Tally
): Promise<void> {
  if (outcome.kind === 'delivered') {
    tally.delivered += 1
    await recordDelivered(id)
    return
  }
  if (outcome.kind === 'gone') {
    tally.gone += 1
    await deleteSubscriptionById(id)
    return
  }
  if (outcome.kind === 'transient') tally.transient += 1
  else tally.rejected += 1
  if (outcome.kind === 'transient' && !attempt.last) return
  const failures = await recordFailure(id)
  if (failures !== null && failures >= MAX_CONSECUTIVE_FAILURES) await deleteSubscriptionById(id)
}

async function visibleViews(
  session: AuthorizedSession,
  own: InboxItem | null,
  burst: readonly InboxItem[],
  preferences: PushPreferences
): Promise<InboxItemView[]> {
  const told = burst.filter(
    (candidate) => isPushStillDue(candidate) && isPushWanted(candidate.type, preferences, candidate.payload)
  )
  const views = await Promise.all((own ? [own, ...told] : told).map((candidate) => viewInboxItemAs(session, candidate)))
  return views.filter((view): view is InboxItemView => view !== null)
}

const burstKeyOf = (burst: readonly InboxItem[], id: string) => burst.find((candidate) => candidate.id === id)?.groupKey

export async function runInboxPush(
  organizationId: string,
  payload: InboxPushPayload,
  attempt: JobAttempt,
  sender?: PushSender
): Promise<InboxPushResult> {
  const config = webPushConfig()
  if (!config) return { sent: false, reason: 'off' }
  const { recipientUserId: userId } = payload

  const session = await resolvePinnedRequesterSessionStrict({ userId, email: null, organizationId })
  if (!session) {
    await deleteAllSubscriptionsOf(organizationId, userId)
    return { sent: false, reason: 'not-a-member' }
  }

  const row = await findInboxItemForRecipient(organizationId, userId, payload.itemId)
  if (!row) return { sent: false, reason: 'no-longer-news' }
  const policy = pushPolicyFor(row.type)
  const news = isPushStillDue(row)
  if (!news && !policy?.fold) return { sent: false, reason: 'no-longer-news' }
  if (row.updatedAt.toISOString() !== payload.stamp) return { sent: false, reason: news ? 'superseded' : 'no-longer-news' }

  const prefs = await findUserPreferences(userId, organizationId)
  const preferences = resolvePushPreferences(prefs?.pushNotifications)
  if (!isPushWanted(row.type, preferences, row.payload)) return { sent: false, reason: 'category-off' }

  const burst = policy?.fold
    ? await readBurst(row, (candidate) => isPushWanted(candidate.type, preferences, candidate.payload))
    : []
  if (burst === 'later') return { sent: false, reason: 'folded' }

  const views = await visibleViews(session, news ? row : null, burst, preferences)
  const view = views.find((candidate) => candidate.id === row.id) ?? views[0]
  if (!view) return { sent: false, reason: news ? 'not-visible' : 'no-longer-news' }
  const locale = localeOf(prefs)
  const message =
    (policy?.fold && views.length > 1 ? buildFoldedPushMessage(views, policy.fold, preferences, locale) : null) ??
    buildPushMessage(view, view.id === row.id ? row.groupKey : (burstKeyOf(burst, view.id) ?? row.groupKey), preferences, locale)
  if (!message) return { sent: false, reason: 'no-address' }

  const devices = await listSubscriptions(organizationId, userId)
  if (devices.length === 0) return { sent: false, reason: 'no-devices' }

  const urgency = policy?.urgency ?? 'normal'
  const body = JSON.stringify(message)
  const send = sender ?? createWebPushSender(config)
  const tally: Tally = { delivered: 0, gone: 0, rejected: 0, transient: 0 }
  await Promise.all(
    devices.map(async (device) => {
      const outcome = await send.send(device, body, {
        ttlSeconds: PUSH_TTL_SECONDS[urgency],
        urgency,
        topic: message.tag,
      })
      await settle(device.id, outcome, attempt, tally)
    })
  )

  if (tally.gone + tally.rejected + tally.transient > 0) {
    console.warn('[push] some devices were not reached', { type: row.type, devices: devices.length, ...tally })
  }
  captureServer({
    event: 'push_notification_sent',
    distinctId: null,
    organizationId,
    properties: {
      item_type: row.type,
      category: pushCategoryOf(row.type, row.payload),
      urgency,
      devices: devices.length,
      items: message.itemId ? 1 : views.length,
      ...tally,
    },
  })
  if (tally.transient > 0 && !attempt.last) {
    throw new Error(`[push] ${tally.transient} of ${devices.length} devices could not be reached; trying again`)
  }
  return { sent: true, ...tally }
}
