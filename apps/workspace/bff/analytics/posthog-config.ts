export interface PostHogConfig {
  host: string
  projectToken: string
  sessionReplay: boolean
  replaySampleRate: number
  proxy: boolean
  release?: string
}

export interface PostHogIdentity {
  distinctId: string
  organizationId: string | null
  organizationName: string | null
  role: string | null
  locale: string
}

export const DISABLED_POSTHOG_CONFIG: PostHogConfig = {
  host: '',
  projectToken: '',
  sessionReplay: false,
  replaySampleRate: 0,
  proxy: false,
  release: '',
}

export const DEFAULT_REPLAY_SAMPLE_RATE = 1

export const POSTHOG_PROXY_PATH = '/ingest'

export const posthogAssetHost = (host: string): string => {
  const trimmed = host.trim().replace(/\/+$/, '')
  return trimmed.replace(/^(https?:\/\/)(us|eu)\.i\.posthog\.com$/i, '$1$2-assets.i.posthog.com')
}

export const posthogUiHost = (host: string): string => {
  const trimmed = host.trim().replace(/\/+$/, '')
  return trimmed.replace(/^(https?:\/\/(?:us|eu))\.i\.posthog\.com$/i, '$1.posthog.com')
}

export const REPLAY_BLOCK_CLASS = 'ph-no-capture'

export const parseReplaySampleRate = (raw: string | undefined): number => {
  const text = (raw ?? '').trim()
  if (!text) return DEFAULT_REPLAY_SAMPLE_RATE
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_REPLAY_SAMPLE_RATE
  return value
}

const parseSwitch = (raw: string | undefined, fallback: boolean): boolean => {
  const text = (raw ?? '').trim().toLowerCase()
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0') return false
  return fallback
}

export const postHogConfigFromEnv = (env: Record<string, string | undefined>): PostHogConfig => ({
  host: env.NEXT_PUBLIC_POSTHOG_HOST ?? '',
  projectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? '',
  sessionReplay: parseSwitch(env.NEXT_PUBLIC_POSTHOG_SESSION_REPLAY, true),
  replaySampleRate: parseReplaySampleRate(env.NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE),
  proxy: parseSwitch(env.NEXT_PUBLIC_POSTHOG_PROXY, true),
  release: (env.GIT_SHA ?? '').trim() === 'unknown' ? '' : (env.GIT_SHA ?? '').trim(),
})
