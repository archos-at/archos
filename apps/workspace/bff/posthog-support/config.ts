import 'server-only'
import { posthogUiHost } from '@/lib/analytics/posthog-config'
import { configuredAppOrigin } from '@/lib/app-origin'
import type { PosthogSupportConfig } from './types'

export function posthogSupportConfigFromEnv(
  env: Record<string, string | undefined>
): PosthogSupportConfig | null {
  const ingestHost = (env.NEXT_PUBLIC_POSTHOG_HOST ?? '').trim().replace(/\/+$/, '')
  const personalApiKey = (env.POSTHOG_PERSONAL_API_KEY ?? '').trim()
  const projectId = (env.POSTHOG_PROJECT_ID ?? '').trim()
  const projectToken = (env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? '').trim()
  if (!ingestHost || !personalApiKey || !projectToken || !/^\d+$/.test(projectId)) return null
  return {
    appHost: posthogUiHost(ingestHost),
    ingestHost,
    projectId,
    projectToken,
    personalApiKey,
    appOrigin: configuredAppOrigin(env),
  }
}
