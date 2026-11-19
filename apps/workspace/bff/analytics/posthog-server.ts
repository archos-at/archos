import 'server-only'

import { PostHog } from 'posthog-node'

import { configuredAppHost } from '@/lib/app-origin'
import { deployedSha, deploymentName } from '@/lib/boot'

import { scrubServerEvent } from './scrub-server-event'

type ServerProperties = Record<string, unknown>

export type ServerEventProperties = Record<string, string | number | boolean | null | undefined>

export type ServerEvent =
  | 'user_signed_in'
  | 'organization_created'
  | 'resource_shared'
  | 'task_assigned'
  | 'mention_released'
  | 'job_run_started'
  | 'job_run_finished'
  | 'document_ingest_started'
  | 'document_ingest_finished'
  | 'document_uploaded'
  | 'bim_query_executed'
  | 'budget_blocked'
  | 'budget_threshold_crossed'
  | 'push_device_registered'
  | 'push_device_removed'
  | 'push_notification_sent'
  | 'annotation_due_reminders_sent'
  | 'annotation_created'
  | 'annotation_closed'
  | 'annotation_reopened'
  | 'annotation_carried'
  | 'llm_usage_hourly'
  | 'llm_usage_by_outcome'
  | 'organization_budget_snapshot'
  | 'agent_operation_called'
  | 'agent_operation_missing'
  | 'product_feedback_ticket_opened'
  | 'product_feedback_reply_sent'
  | 'inbound_mail_received'
  | 'inbound_mail_refused'
  | 'inbound_mail_dropped'
  | 'inbound_mail_decided'
  | 'inbound_mail_sender_filed'
  | 'inbound_mail_address_rotated'
  | 'mail_thread_followed'
  | 'mail_thread_original_downloaded'
  | 'norm_recognized_at_upload'
  | 'office_norm_cited'

let client: PostHog | null = null
let resolved = false

export const posthogServerSettings = (): { host: string; projectToken: string } | null => {
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '').trim().replace(/\/+$/, '')
  const projectToken = (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? '').trim()
  if (!host || !projectToken) return null
  return { host, projectToken }
}

export const isPosthogServerEnabled = (): boolean => posthogServerSettings() !== null

export const serverSuperProperties = (): {
  release: string
  service: string
  app_host?: string
  deployment?: string
} => {
  const host = configuredAppHost()
  const deployment = deploymentName()
  return {
    release: deployedSha(),
    service: process.env.OTEL_SERVICE_NAME?.trim() || 'grid-ui',
    ...(host ? { app_host: host } : {}),
    ...(deployment ? { deployment } : {}),
  }
}

export const getPosthogServer = (): PostHog | null => {
  if (resolved) return client
  const config = posthogServerSettings()
  if (config) {
    client = new PostHog(config.projectToken, {
      host: config.host,
      disableGeoip: true,
      before_send: scrubServerEvent,
      flushAt: 20,
      flushInterval: 5_000,
    })
    void client.register(serverSuperProperties())
  }
  resolved = true
  return client
}

export const ORGANIZATION_GROUP = 'organization'
export const SYSTEM_DISTINCT_ID = 'system'

export const organizationProperties = (organizationId: string): ServerProperties => ({
  organization_id: organizationId,
  $groups: { [ORGANIZATION_GROUP]: organizationId },
})

export const serverEventIdentity = (
  distinctId: string | null | undefined,
  organizationId: string | null | undefined,
): { distinctId: string; properties: ServerProperties } => {
  const properties: ServerProperties = organizationId ? organizationProperties(organizationId) : {}
  if (distinctId) return { distinctId, properties }
  properties.$process_person_profile = false
  return { distinctId: organizationId ? `${ORGANIZATION_GROUP}:${organizationId}` : SYSTEM_DISTINCT_ID, properties }
}

export interface ServerCapture {
  event: ServerEvent
  distinctId: string | null
  organizationId?: string | null
  properties?: ServerEventProperties
}

export const captureServer = ({ event, distinctId, organizationId, properties }: ServerCapture): boolean => {
  const posthog = getPosthogServer()
  if (!posthog) return false
  const identity = serverEventIdentity(distinctId, organizationId)
  const props: ServerProperties = { ...properties, ...identity.properties }
  try {
    posthog.capture({ event, distinctId: identity.distinctId, properties: props })
    return true
  } catch (error) {
    console.debug('[posthog] could not queue event', event, error)
    return false
  }
}

export interface PosthogBatch {
  capture(event: ServerCapture & { timestamp: Date }): void
  flush(): Promise<void>
  close(): Promise<void>
}

const BATCH_QUEUE_LIMIT = 2_000

export const createPosthogBatch = (): PosthogBatch | null => {
  const config = posthogServerSettings()
  if (!config) return null
  const posthog = new PostHog(config.projectToken, {
    host: config.host,
    disableGeoip: true,
    before_send: scrubServerEvent,
    flushAt: BATCH_QUEUE_LIMIT,
    flushInterval: 0,
    maxQueueSize: BATCH_QUEUE_LIMIT,
  })
  void posthog.register(serverSuperProperties())
  return {
    capture: ({ event, distinctId, organizationId, properties, timestamp }) => {
      const identity = serverEventIdentity(distinctId, organizationId)
      posthog.capture({
        event,
        distinctId: identity.distinctId,
        properties: { ...properties, ...identity.properties },
        timestamp,
      })
    },
    flush: () => posthog.flush(),
    close: async () => {
      try {
        await posthog.shutdown()
      } catch (error) {
        console.debug('[posthog] export client shutdown failed', error)
      }
    },
  }
}

export const shutdownPosthogServer = async (): Promise<void> => {
  if (!client) return
  try {
    await client.shutdown()
  } catch (error) {
    console.debug('[posthog] shutdown failed', error)
  }
}

export const resetPosthogServerForTests = (): void => {
  client = null
  resolved = false
}
