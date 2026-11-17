import 'server-only'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { captureServer } from '@/lib/analytics/posthog-server'
import type { PushSubscriptionRow } from '@/lib/db/schema/push-subscriptions'
import {
  applyPushPreferencesPatch,
  resolvePushPreferences,
  type PushPreferences,
  type PushPreferencesPatch,
} from '@/lib/inbox/push-categories'
import { getUserPreferences, mergeUserPreferences } from '@/lib/user-preferences/service'
import { webPushConfig } from './config'
import { deviceLabelFromUserAgent } from './device-label'
import {
  claimEndpoint,
  deleteSubscription,
  deleteSubscriptionByEndpoint,
  listSubscriptions,
  MAX_DEVICES_PER_PERSON,
  trimSubscriptions,
  upsertSubscription,
} from './repository'
import { isSendableEndpoint } from './sender'
import type { PushConfigResponse, PushDeviceView, RegisterDeviceBody } from './types'

export const PUSH_PREFERENCES_KEY = 'pushNotifications'

function toDeviceView(row: PushSubscriptionRow): PushDeviceView {
  return {
    id: row.id,
    label: row.deviceLabel,
    endpoint: row.endpoint,
    createdAt: row.createdAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null,
  }
}

export function getPushConfig(): PushConfigResponse {
  const config = webPushConfig()
  return config ? { enabled: true, publicKey: config.publicKey } : { enabled: false, publicKey: null }
}

export async function registerDevice(
  session: AuthorizedSession,
  body: RegisterDeviceBody,
  userAgent: string | null
): Promise<PushDeviceView> {
  if (!webPushConfig()) throw new NotFoundError()
  if (!isSendableEndpoint(body.endpoint)) throw new BadRequestError('Not a push service endpoint')
  const { organizationId, userId } = session
  if (body.replaces) {
    const replacedOwn = await deleteSubscriptionByEndpoint(organizationId, userId, body.replaces)
    if (!replacedOwn) throw new ConflictError('The replaced subscription is not one of your devices')
  }
  await claimEndpoint(organizationId, userId, body.endpoint)
  const row = await upsertSubscription({
    organizationId,
    userId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    deviceLabel: deviceLabelFromUserAgent(userAgent),
  })
  await trimSubscriptions(organizationId, userId)
  captureServer({ event: 'push_device_registered', distinctId: userId, organizationId })
  return toDeviceView(row)
}

export async function listDevices(session: AuthorizedSession): Promise<PushDeviceView[]> {
  const rows = await listSubscriptions(session.organizationId, session.userId)
  return rows.slice(0, MAX_DEVICES_PER_PERSON).map(toDeviceView)
}

export async function removeDevice(session: AuthorizedSession, deviceId: string): Promise<void> {
  const removed = await deleteSubscription(session.organizationId, session.userId, deviceId)
  if (!removed) throw new NotFoundError()
  captureServer({ event: 'push_device_removed', distinctId: session.userId, organizationId: session.organizationId })
}

export async function getPushPreferences(session: AuthorizedSession): Promise<PushPreferences> {
  const prefs = await getUserPreferences(session)
  return resolvePushPreferences(prefs[PUSH_PREFERENCES_KEY])
}

export async function updatePushPreferences(
  session: AuthorizedSession,
  patch: PushPreferencesPatch
): Promise<PushPreferences> {
  const next = applyPushPreferencesPatch(await getPushPreferences(session), patch)
  await mergeUserPreferences(session, { [PUSH_PREFERENCES_KEY]: next })
  return next
}
