export const LLM_CREDENTIAL_PROVIDERS = ['openrouter', 'openai', 'azure-openai', 'custom'] as const
export type LlmCredentialProvider = (typeof LLM_CREDENTIAL_PROVIDERS)[number]

interface ProviderPreset {
  defaultBaseUrl: string | null
  allowsCustomBaseUrl: boolean
}

const PRESETS: Record<LlmCredentialProvider, ProviderPreset> = {
  openrouter: { defaultBaseUrl: 'https://openrouter.ai/api/v1', allowsCustomBaseUrl: false },
  openai: { defaultBaseUrl: 'https://api.openai.com/v1', allowsCustomBaseUrl: false },
  'azure-openai': { defaultBaseUrl: null, allowsCustomBaseUrl: true },
  custom: { defaultBaseUrl: null, allowsCustomBaseUrl: true },
}

export function isKnownProvider(value: string): value is LlmCredentialProvider {
  return (LLM_CREDENTIAL_PROVIDERS as readonly string[]).includes(value)
}

export function resolveBaseUrl(provider: LlmCredentialProvider, baseUrl: string | null | undefined): string {
  const preset = PRESETS[provider]
  const supplied = baseUrl?.trim() || null
  if (supplied && !preset.allowsCustomBaseUrl) {
    throw new Error(`Provider "${provider}" uses its fixed endpoint; a custom base URL is not allowed`)
  }
  const effective = supplied ?? preset.defaultBaseUrl
  if (!effective) {
    throw new Error(`Provider "${provider}" requires a base URL`)
  }
  return effective.replace(/\/+$/, '')
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fd[0-9a-f]{2}:/i,
  /\.(local|internal|localdomain)$/i,
]

export function assertSafeBaseUrl(effectiveBaseUrl: string): void {
  let url: URL
  try {
    url = new URL(effectiveBaseUrl)
  } catch {
    throw new Error('Base URL is not a valid URL')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Base URL must use HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Base URL must not embed credentials')
  }
  const allowPrivate = (process.env.BYOK_ALLOW_PRIVATE_BASE_URLS ?? '').toLowerCase() === 'true'
  if (allowPrivate) return
  const host = url.hostname
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new Error('Base URL points at a private or local network address')
  }
}
