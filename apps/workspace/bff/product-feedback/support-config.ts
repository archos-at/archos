import 'server-only'
import { posthogSupportConfigFromEnv } from '@/lib/posthog-support/config'
import type { PosthogSupportConfig } from '@/lib/posthog-support/types'

export const supportConfig = (): PosthogSupportConfig | null => posthogSupportConfigFromEnv(process.env)
