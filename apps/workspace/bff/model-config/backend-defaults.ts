import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import { AGENT_GROUPS } from './agent-groups'
import { getPlatformModelDefaults } from './platform-defaults'

export type GroupDefaults = Record<string, string | null>

const CACHE_TTL_MS = 5 * 60 * 1000

const LLM_DEFAULTS_TIMEOUT_MS = 10_000

export type LlmBaseUrls = Record<string, string | null>

interface LlmDefaults {
  llms: Record<string, string | null>
  baseUrls: LlmBaseUrls
  reasoningEfforts: Record<string, string | null>
}

let cache: { fetchedAt: number; defaults: LlmDefaults } | null = null

async function fetchLlmDefaults(): Promise<LlmDefaults> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.defaults
  }
  const base = getBackendUrl()
  const headers: Record<string, string> = { Accept: 'application/json' }
  try {
    Object.assign(headers, internalServiceHeaders(base))
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    if (error.reason === 'unsafe_destination') {
      console.warn(
        `[Model Config] Withholding the internal token: BACKEND_URL (${base}) is plain HTTP to a non-internal host. Use https, or an internal hostname/private address.`
      )
    }
  }

  const response = await fetch(`${base}/v1/config/llm-defaults`, {
    headers,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(LLM_DEFAULTS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`llm-defaults request failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as {
    llms?: Record<string, string | null>
    baseUrls?: LlmBaseUrls
    reasoningEfforts?: Record<string, string | null>
  }
  const defaults: LlmDefaults = {
    llms: body.llms ?? {},
    baseUrls: body.baseUrls ?? {},
    reasoningEfforts: body.reasoningEfforts ?? {},
  }
  cache = { fetchedAt: Date.now(), defaults }
  return defaults
}

export async function getWorkflowLlmBaseUrls(): Promise<LlmBaseUrls> {
  const { baseUrls } = await fetchLlmDefaults()
  return baseUrls
}

export async function getWorkflowGroupReasoningEfforts(): Promise<GroupDefaults> {
  const efforts: GroupDefaults = Object.fromEntries(AGENT_GROUPS.map((group) => [group.id, null]))
  try {
    const { reasoningEfforts } = await fetchLlmDefaults()
    for (const group of AGENT_GROUPS) {
      const values = [
        ...new Set(
          group.configLlmRefs
            .map((ref) => reasoningEfforts[ref])
            .filter((value): value is string => typeof value === 'string'),
        ),
      ]
      efforts[group.id] = values.length > 0 ? values.join(', ') : null
    }
  } catch (error) {
    console.warn('[Model Config] Could not resolve workflow reasoning efforts from backend:', error)
  }
  return efforts
}

export function splitGroupDefault(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

export async function getWorkflowGroupDefaults(): Promise<GroupDefaults> {
  const defaults: GroupDefaults = Object.fromEntries(AGENT_GROUPS.map((group) => [group.id, null]))
  try {
    const { llms } = await fetchLlmDefaults()
    for (const group of AGENT_GROUPS) {
      const models = [
        ...new Set(group.configLlmRefs.map((ref) => llms[ref]).filter((m): m is string => typeof m === 'string')),
      ]
      defaults[group.id] = models.length > 0 ? models.join(', ') : null
    }
  } catch (error) {
    console.warn('[Model Config] Could not resolve workflow-default models from backend:', error)
  }
  return defaults
}

export type DefaultSource = 'platform' | 'workflow'

export interface GroupDefaultSource {
  model: string | null
  source: DefaultSource | null
}

export async function getGroupDefaultSources(): Promise<Record<string, GroupDefaultSource>> {
  const [workflowDefaults, platformDefaults] = await Promise.all([
    getWorkflowGroupDefaults(),
    getPlatformModelDefaults().catch((error) => {
      console.warn('[Model Config] Could not resolve platform model defaults:', error)
      return {} as Record<string, string>
    }),
  ])
  return Object.fromEntries(
    AGENT_GROUPS.map(({ id }): [string, GroupDefaultSource] => {
      if (platformDefaults[id]) return [id, { model: platformDefaults[id], source: 'platform' }]
      const workflow = workflowDefaults[id] ?? null
      return [id, { model: workflow, source: workflow ? 'workflow' : null }]
    })
  )
}

export async function getGroupDefaults(): Promise<GroupDefaults> {
  const sources = await getGroupDefaultSources()
  return Object.fromEntries(Object.entries(sources).map(([group, { model }]) => [group, model]))
}

export function _clearDefaultsCache(): void {
  cache = null
}
