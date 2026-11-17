import posthog, {
  type BeforeSendFn,
  type CapturedNetworkRequest,
  type PostHogConfig as PostHogSdkConfig,
  type SessionRecordingOptions,
} from 'posthog-js'

import {
  DISABLED_POSTHOG_CONFIG,
  POSTHOG_PROXY_PATH,
  REPLAY_BLOCK_CLASS,
  postHogConfigFromEnv,
  posthogUiHost,
  type PostHogConfig,
  type PostHogIdentity,
} from './posthog-config'
import { isControlFlowExceptionEvent, isFrameworkControlFlow } from './control-flow-error'
import { SENSITIVE_QUERY_KEYS, scrubDeep } from './posthog-scrub'

export { DISABLED_POSTHOG_CONFIG, postHogConfigFromEnv, type PostHogConfig, type PostHogIdentity }

type PostHogProperties = Record<string, string | number | boolean | null | undefined>

export type PostHogEvent =
  | 'product_tour_completed'
  | 'product_tour_skipped'
  | 'project_created'
  | 'project_member_access_changed'
  | 'job_created'
  | 'job_updated'
  | 'job_enabled_changed'
  | 'job_run_submitted'
  | 'job_deleted'
  | 'skill_created'
  | 'skill_updated'
  | 'skill_deleted'
  | 'skill_enabled_changed'
  | 'answer_retry_thorough'
  | 'answer_feedback_submitted'
  | 'answer_completed'
  | 'citation_opened'
  | 'document_opened'
  | 'ifc_model_opened'
  | 'product_feedback_submitted'
  | 'document_uploaded'
  | 'chat_message_sent'
  | 'report_exported'
  | 'similar_passages_searched'
  | 'similar_passage_opened'
  | 'search_issued'
  | 'search_result_opened'
  | 'search_refined'
  | 'saved_search_created'
  | 'saved_search_run'
  | 'search_suggestion_picked'
  | 'usage_notice_shown'
  | 'usage_notice_dismissed'
  | 'viewer_action_outcome'
  | 'viewer_actions_auto_changed'
  | 'whats_new_shown'
  | 'whats_new_dismissed'
  | 'whats_new_opened'
  | 'whats_new_opted_out'
  | 'whats_new_opted_in'
  | 'inbound_mail_details_opened'
  | 'inbound_mail_filed_as_suggested'
  | 'inbound_mail_filed_outcome_opened'
  | 'inbound_mail_address_copied'
  | 'inbound_mail_address_contact_saved'

let initialized = false

export const stripUrlQuery = (url: string): string => {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

export const SERVICE_HEADER_NAMES = [
  'x-answer-message-id',
  'x-budget',
  'x-collection-scope',
  'x-context-transport',
  'x-disabled-sources',
  'x-feature-memory-reflection',
  'x-locale',
  'x-model-overrides',
  'x-org-instructions',
  'x-organization-id',
  'x-project-context',
  'x-project-id',
  'x-project-memory',
  'x-request-context',
  'x-request-context-sig',
  'x-user-id',
]

const SECRET_HEADER = new RegExp(
  `^(?:authorization|proxy-authorization|cookie|set-cookie|x-grid-.*|x-workos-.*|x-api-key|.*token.*|.*secret.*|${SERVICE_HEADER_NAMES.join('|')})$`,
  'i'
)

const NO_BODY_PATH =
  /^\/api\/(?:organization\/llm-credentials|internal|auth|organization\/audit-portal|platform\/audit-portal)(?:\/|$)/

const pathOf = (url: string): string => {
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return stripUrlQuery(url)
  }
}

type RecordedHeaders = CapturedNetworkRequest['requestHeaders']

const withoutSecretHeaders = (headers: RecordedHeaders): RecordedHeaders => {
  if (!headers) return headers
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !SECRET_HEADER.test(name)))
}

const mayKeepBodies = (request: CapturedNetworkRequest, path: string): boolean =>
  !NO_BODY_PATH.test(path) && typeof request.status === 'number' && request.status >= 400

export const maskReplayNetworkRequest = (request: CapturedNetworkRequest): CapturedNetworkRequest => {
  const name = stripUrlQuery(request.name)
  const keepBodies = mayKeepBodies(request, pathOf(name))
  return {
    ...request,
    name,
    requestHeaders: withoutSecretHeaders(request.requestHeaders),
    responseHeaders: withoutSecretHeaders(request.responseHeaders),
    requestBody: keepBodies ? request.requestBody : undefined,
    responseBody: keepBodies ? request.responseBody : undefined,
  }
}

export const SIGNED_URL_BLOCK_SELECTOR = ['src', 'srcset', 'href', 'data', 'poster']
  .flatMap((attribute) => [`[${attribute}*="sig=" i]`, `[${attribute}*="sig%3D" i]`])
  .join(', ')

export const buildSessionRecordingOptions = (sampleRate: number): SessionRecordingOptions => ({
  maskAllInputs: true,
  maskTextSelector: '*',
  blockClass: REPLAY_BLOCK_CLASS,
  blockSelector: `img, video, canvas, iframe, object, embed, [data-ph-no-capture], ${SIGNED_URL_BLOCK_SELECTOR}`,
  captureCanvas: { recordCanvas: false },
  recordHeaders: true,
  recordBody: true,
  maskCapturedNetworkRequestFn: maskReplayNetworkRequest,
  sampleRate,
})

export const scrubEvent: BeforeSendFn = (capture) => {
  if (!capture) return capture
  if (isControlFlowExceptionEvent(capture.event, capture.properties)) return null
  const properties =
    capture.event === '$snapshot'
      ? Object.fromEntries(
          Object.entries(capture.properties).map(([key, value]) => [
            key,
            key === '$snapshot_data' ? value : scrubDeep(value),
          ])
        )
      : scrubDeep(capture.properties)
  return {
    ...capture,
    properties,
    ...(capture.$set ? { $set: scrubDeep(capture.$set) } : {}),
    ...(capture.$set_once ? { $set_once: scrubDeep(capture.$set_once) } : {}),
  }
}

export interface IdentityClient {
  get_distinct_id: () => string
  reset: () => void
  identify: (distinctId: string) => void
  register?: (properties: Record<string, string>) => void
}

let releaseTag = ''

export const registerRelease = (client: Pick<IdentityClient, 'register'>, release: string): void => {
  releaseTag = release
  if (release) client.register?.({ release })
}

export const ORGANIZATION_GROUP = 'organization'

export const adoptServerIdentity = (client: IdentityClient, distinctId: string): void => {
  if (client.get_distinct_id() === distinctId) return
  client.reset()
  client.identify(distinctId)
}

export const buildPosthogInitOptions = (
  config: PostHogConfig,
  identity?: PostHogIdentity | null,
  appHostname?: string
): Partial<PostHogSdkConfig> => ({
  api_host: config.proxy ? POSTHOG_PROXY_PATH : config.host,
  ...(config.proxy ? { ui_host: posthogUiHost(config.host) } : {}),
  defaults: '2026-01-30',
  persistence: 'localStorage+cookie',
  cross_subdomain_cookie: true,
  person_profiles: 'identified_only',
  ...(identity ? { bootstrap: { distinctID: identity.distinctId, isIdentifiedID: true } } : {}),
  loaded: (client: IdentityClient) => {
    if (identity) adoptServerIdentity(client, identity.distinctId)
    registerRelease(client, config.release ?? '')
  },
  capture_pageview: 'history_change',
  capture_heatmaps: true,
  capture_performance: { web_vitals: true, web_vitals_attribution: ['CLS', 'INP', 'LCP'], network_timing: true },
  capture_dead_clicks: true,
  mask_personal_data_properties: true,
  custom_personal_data_properties: [...SENSITIVE_QUERY_KEYS],
  mask_all_text: false,
  mask_all_element_attributes: false,
  before_send: scrubEvent,
  capture_exceptions: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: false,
  },
  disable_session_recording: !config.sessionReplay,
  enable_recording_console_log: false,
  session_recording: buildSessionRecordingOptions(config.replaySampleRate),
  ...(appHostname ? { tracing_headers: [appHostname] } : {}),
  debug: process.env.NODE_ENV === 'development',
})

export const initPosthogClient = (config: PostHogConfig, identity?: PostHogIdentity | null): void => {
  if (initialized || typeof window === 'undefined') return
  if (!config.host || !config.projectToken) return
  posthog.init(config.projectToken, buildPosthogInitOptions(config, identity, window.location.hostname))
  initialized = true
}

export const isPosthogEnabled = (): boolean => initialized

export const capturePosthog = (event: PostHogEvent, properties?: PostHogProperties): void => {
  if (!initialized) return
  posthog.capture(event, properties)
}

export const capturePosthogException = (error: unknown, properties?: PostHogProperties): void => {
  if (!initialized || isFrameworkControlFlow(error)) return
  posthog.captureException(error, properties)
}

export const identifyPosthog = (distinctId: string): void => {
  if (!initialized) return
  posthog.identify(distinctId)
}

export interface PostHogContext {
  organizationId?: string | null
  organizationName?: string | null
  role?: string | null
  locale?: string | null
}

const CONTEXT_PROPERTIES = {
  organizationId: 'organization_id',
  organizationName: 'organization_name',
  role: 'user_role',
  locale: 'locale',
} as const satisfies Record<keyof PostHogContext, string>

export const registerPosthogContext = (context: PostHogContext): void => {
  if (!initialized) return
  const present: Record<string, string> = {}
  const person: Record<string, string | null> = {}
  for (const key of Object.keys(CONTEXT_PROPERTIES) as Array<keyof PostHogContext>) {
    const value = context[key]
    person[CONTEXT_PROPERTIES[key]] = value || null
    if (value) present[CONTEXT_PROPERTIES[key]] = value
    else posthog.unregister(CONTEXT_PROPERTIES[key])
  }
  if (Object.keys(present).length > 0) posthog.register(present)
  posthog.setPersonProperties(person)
  if (context.organizationId) {
    posthog.group(
      ORGANIZATION_GROUP,
      context.organizationId,
      context.organizationName ? { name: context.organizationName } : undefined
    )
  } else {
    posthog.resetGroups()
  }
}

export const optOutPosthog = (): void => {
  if (!initialized) return
  posthog.opt_out_capturing()
}

export const optInPosthog = (): void => {
  if (!initialized) return
  posthog.opt_in_capturing()
}

export const isPosthogOptedOut = (): boolean => {
  if (!initialized) return false
  return posthog.has_opted_out_capturing()
}

export const resetPosthog = (): void => {
  if (!initialized) return
  posthog.reset()
  registerRelease(posthog, releaseTag)
}

const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const getPosthogSessionId = (): string | null => {
  if (!initialized) return null
  const id = posthog.get_session_id()
  return typeof id === 'string' && SESSION_ID_SHAPE.test(id) ? id : null
}

export const getPosthogSupportContext = (): { sessionId: string | null } => {
  if (!initialized) return { sessionId: null }
  return { sessionId: readSessionIdSafely() }
}

const readSessionIdSafely = (): string | null => {
  try {
    return getPosthogSessionId()
  } catch {
    return null
  }
}
