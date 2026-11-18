import 'server-only'

export interface LangfuseApiConfig {
  publicKey: string
  secretKey: string
  baseUrl: string
}

export interface LangfuseUiConfig {
  publicUrl: string
  projectId: string
}

const env = (name: string): string | null => {
  const value = process.env[name]?.trim()
  return value ? value : null
}

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

export function langfuseApiConfig(): LangfuseApiConfig | null {
  const publicKey = env('LANGFUSE_PUBLIC_KEY')
  const secretKey = env('LANGFUSE_SECRET_KEY')
  const baseUrl = env('LANGFUSE_HOST')
  if (!publicKey || !secretKey || !baseUrl) return null
  return { publicKey, secretKey, baseUrl: withoutTrailingSlash(baseUrl) }
}

export function langfuseUiConfig(): LangfuseUiConfig | null {
  const publicUrl = env('LANGFUSE_PUBLIC_URL')
  const projectId = env('LANGFUSE_PROJECT_ID')
  if (!publicUrl || !projectId) return null
  return { publicUrl: withoutTrailingSlash(publicUrl), projectId }
}

const TRACE_ID = /^[0-9a-f]{32}$/

export function isTraceId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_ID.test(value)
}

export function langfuseProjectUrl(ui: LangfuseUiConfig | null = langfuseUiConfig()): string | null {
  if (!ui) return null
  return `${ui.publicUrl}/project/${encodeURIComponent(ui.projectId)}`
}

export function langfuseTraceUrl(
  traceId: string | null | undefined,
  ui: LangfuseUiConfig | null = langfuseUiConfig()
): string | null {
  const project = langfuseProjectUrl(ui)
  if (!project || !isTraceId(traceId)) return null
  return `${project}/traces/${traceId}`
}
