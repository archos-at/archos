import 'server-only'
import { getCached, invalidateCached } from '@/lib/cache'
import {
  AGENT_GROUPS,
  getAgentGroup,
  OPENROUTER_MODEL_ID_PATTERN,
  type AgentGroupDefinition,
} from './agent-groups'
import { ServiceUnavailableError } from '@/lib/api/errors'
import { ZDR_LIST_UNAVAILABLE, type ModelRejection } from './rejections'

export interface OpenRouterModel {
  id: string
  name: string
  description?: string
  contextLength: number
  promptPrice: number
  completionPrice: number
  inputModalities: string[]
  supportedParameters: string[]
}

export interface ModelValidationResult {
  ok: boolean
  reasons: ModelRejection[]
}

const CATALOG_TTL_MS = 5 * 60 * 1000
const CATALOG_CACHE_KEY = 'openrouter:catalog'
// v3: v1 cached a Set (JSON turns it into {}, issue #242), v2 bare ids; older entries live in the shared cache up to CATALOG_TTL_MS after a deploy.
const ZDR_CACHE_KEY = 'openrouter:zdr-endpoints:v3'

function baseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function parseModel(raw: unknown): OpenRouterModel | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || !OPENROUTER_MODEL_ID_PATTERN.test(entry.id)) return null
  const architecture = (entry.architecture ?? {}) as Record<string, unknown>
  const pricing = (entry.pricing ?? {}) as Record<string, unknown>
  return {
    id: entry.id,
    name: typeof entry.name === 'string' ? entry.name : entry.id,
    description: typeof entry.description === 'string' ? entry.description : undefined,
    contextLength: toNumber(entry.context_length),
    promptPrice: toNumber(pricing.prompt),
    completionPrice: toNumber(pricing.completion),
    inputModalities: Array.isArray(architecture.input_modalities)
      ? architecture.input_modalities.filter((m): m is string => typeof m === 'string')
      : [],
    supportedParameters: Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters.filter((p): p is string => typeof p === 'string')
      : [],
  }
}

export async function fetchModelCatalog(): Promise<OpenRouterModel[]> {
  return getCached(CATALOG_CACHE_KEY, CATALOG_TTL_MS, async () => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const apiKey = process.env.OPENROUTER_API_KEY
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${baseUrl()}/models`, { headers, cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`OpenRouter model catalog request failed: HTTP ${response.status}`)
    }
    const body = (await response.json()) as { data?: unknown[] }
    const models = (body.data ?? []).map(parseModel).filter((m): m is OpenRouterModel => m !== null)
    if (models.length === 0) {
      throw new Error('OpenRouter model catalog response contained no models')
    }
    return models
  })
}

export async function _clearCatalogCache(): Promise<void> {
  await invalidateCached(CATALOG_CACHE_KEY)
  await invalidateCached(ZDR_CACHE_KEY)
}

export interface ZdrEndpoint {
  modelId: string
  supportedParameters: string[]
  contextLength: number
}

export type ZdrIndex = ReadonlyMap<string, readonly ZdrEndpoint[]>

export class ZdrListUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ZdrListUnavailableError'
  }
}

export function catalogUnavailableError(error: unknown): ServiceUnavailableError {
  if (error instanceof ZdrListUnavailableError) {
    return new ServiceUnavailableError(
      'The zero-data-retention list could not be loaded, so no model can be confirmed as ZDR; try again later',
      { reason: ZDR_LIST_UNAVAILABLE }
    )
  }
  return new ServiceUnavailableError('The model catalog is unavailable; try again later')
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// Live shape of GET /endpoints/zdr, verified 2026-09: {data: [{model_id, provider_name, tag, supported_parameters, context_length}]}; only model_id names the model, tag and name only look like ids.
function parseZdrEndpoint(raw: unknown): ZdrEndpoint | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.model_id !== 'string' || !OPENROUTER_MODEL_ID_PATTERN.test(entry.model_id)) return null
  return {
    modelId: entry.model_id,
    supportedParameters: stringList(entry.supported_parameters),
    contextLength: toNumber(entry.context_length),
  }
}

function dedupeEndpoints(endpoints: ZdrEndpoint[]): ZdrEndpoint[] {
  const seen = new Set<string>()
  return endpoints.filter((endpoint) => {
    const key = JSON.stringify([endpoint.modelId, [...endpoint.supportedParameters].sort(), endpoint.contextLength])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isUsableEndpoint(value: unknown): value is ZdrEndpoint {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ZdrEndpoint>
  return (
    typeof entry.modelId === 'string' &&
    OPENROUTER_MODEL_ID_PATTERN.test(entry.modelId) &&
    Array.isArray(entry.supportedParameters) &&
    entry.supportedParameters.every((param) => typeof param === 'string') &&
    typeof entry.contextLength === 'number'
  )
}

async function loadZdrEndpoints(): Promise<ZdrEndpoint[]> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(`${baseUrl()}/endpoints/zdr`, { headers, cache: 'no-store' })
  if (!response.ok) {
    throw new ZdrListUnavailableError(`OpenRouter ZDR endpoint listing request failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as { data?: unknown }
  const endpoints = (Array.isArray(body.data) ? body.data : [])
    .map(parseZdrEndpoint)
    .filter((endpoint): endpoint is ZdrEndpoint => endpoint !== null)
  if (endpoints.length === 0) {
    throw new ZdrListUnavailableError('OpenRouter ZDR endpoint listing contained no model ids')
  }
  return dedupeEndpoints(endpoints)
}

export async function fetchZdrEndpoints(): Promise<ZdrIndex> {
  let endpoints: unknown
  try {
    endpoints = await getCached<ZdrEndpoint[]>(ZDR_CACHE_KEY, CATALOG_TTL_MS, loadZdrEndpoints)
  } catch (error) {
    if (error instanceof ZdrListUnavailableError) throw error
    throw new ZdrListUnavailableError(`OpenRouter ZDR endpoint listing is unavailable: ${String(error)}`, {
      cause: error,
    })
  }

  if (!Array.isArray(endpoints) || endpoints.length === 0 || !endpoints.every(isUsableEndpoint)) {
    throw new ZdrListUnavailableError('OpenRouter ZDR endpoint listing is unusable')
  }
  const index = new Map<string, ZdrEndpoint[]>()
  for (const endpoint of endpoints) {
    const list = index.get(endpoint.modelId)
    if (list) list.push(endpoint)
    else index.set(endpoint.modelId, [endpoint])
  }
  return index
}

export const ZDR_ROUTING_ONLY_VARIANTS: readonly string[] = ['nitro', 'floor']

export function zdrEndpointsFor(modelId: string, zdr: ZdrIndex): readonly ZdrEndpoint[] {
  const exact = zdr.get(modelId)
  if (exact) return exact
  const colon = modelId.indexOf(':')
  if (colon < 0) return []
  const variant = modelId.slice(colon + 1)
  return ZDR_ROUTING_ONLY_VARIANTS.includes(variant) ? (zdr.get(modelId.slice(0, colon)) ?? []) : []
}

export function zdrEndpointServesGroup(endpoint: ZdrEndpoint, group: AgentGroupDefinition): boolean {
  const { requiredParameters, minContextLength } = group.requirements
  if (endpoint.contextLength > 0 && endpoint.contextLength < minContextLength) return false
  return requiredParameters.every((param) => endpoint.supportedParameters.includes(param))
}

export function hasZdrEndpoint(modelId: string, zdr: ZdrIndex, group?: AgentGroupDefinition): boolean {
  if (!group) return zdrEndpointsFor(modelId, zdr).length > 0
  return zdrShortfall(modelId, group, zdr) === null
}

export type ZdrShortfall = 'not_zdr' | 'zdr_endpoint_lacks_capability'

export function zdrShortfall(modelId: string, group: AgentGroupDefinition, zdr: ZdrIndex): ZdrShortfall | null {
  const endpoints = zdrEndpointsFor(modelId, zdr)
  if (endpoints.length === 0) return 'not_zdr'
  return endpoints.some((endpoint) => zdrEndpointServesGroup(endpoint, group)) ? null : 'zdr_endpoint_lacks_capability'
}

export function zdrRejection(
  model: Pick<OpenRouterModel, 'id'>,
  group: AgentGroupDefinition,
  zdr: ZdrIndex
): ModelRejection | null {
  const shortfall = zdrShortfall(model.id, group, zdr)
  if (!shortfall) return null
  return {
    code: shortfall,
    message:
      shortfall === 'not_zdr'
        ? `model '${model.id}' has no zero-data-retention endpoint`
        : `no zero-data-retention endpoint of '${model.id}' supports what this group requires`,
    params: { model: model.id },
  }
}

export const REASONING_MANDATORY_PREFIXES: string[] = [
  'openai/o1',
  'openai/o3',
  'openai/o4',
  'x-ai/grok-4',
  'deepseek/deepseek-r1',
]
export const REASONING_MANDATORY_IDS: string[] = []

export function isReasoningSafeForOff(model: OpenRouterModel): boolean {
  if (REASONING_MANDATORY_IDS.includes(model.id)) return false
  return !REASONING_MANDATORY_PREFIXES.some((prefix) => model.id.startsWith(prefix))
}

export function validateModelForGroup(
  model: OpenRouterModel,
  group: AgentGroupDefinition,
  strictCapabilities = true,
  zdr: ZdrIndex | null = null,
): ModelValidationResult {
  const reasons: ModelRejection[] = []
  if (model.inputModalities.length > 0 && !model.inputModalities.includes('text')) {
    reasons.push({ code: 'no_text_input', message: 'model does not accept text input' })
  }
  if (
    group.requirements.requiresImageInput &&
    model.inputModalities.length > 0 &&
    !model.inputModalities.includes('image')
  ) {
    reasons.push({
      code: 'no_image_input',
      message: 'model does not accept image input (a vision model is required)',
    })
  }
  if (model.contextLength > 0 && model.contextLength < group.requirements.minContextLength) {
    reasons.push({
      code: 'context_too_small',
      message: `context length ${model.contextLength} is below the required ${group.requirements.minContextLength}`,
      params: { actual: model.contextLength, required: group.requirements.minContextLength },
    })
  }
  if (strictCapabilities) {
    for (const param of group.requirements.requiredParameters) {
      if (!model.supportedParameters.includes(param)) {
        reasons.push({
          code: 'missing_parameter',
          message: `model does not support required parameter '${param}'`,
          params: { parameter: param },
        })
      }
    }
  }
  if (group.requirements.reasoningOff && !isReasoningSafeForOff(model)) {
    reasons.push({
      code: 'reasoning_mandatory',
      message: 'model always reasons, and this group runs with reasoning off',
    })
  }
  const zdrReason = zdr ? zdrRejection(model, group, zdr) : null
  if (zdrReason) reasons.push(zdrReason)
  return { ok: reasons.length === 0, reasons }
}

export function searchModelsForGroup(
  catalog: OpenRouterModel[],
  groupId: string,
  query: string,
  limit = 30,
  strictCapabilities = true,
  zdr: ZdrIndex | null = null,
): OpenRouterModel[] {
  const group = getAgentGroup(groupId)
  if (!group) return []
  const q = query.trim().toLowerCase()
  return catalog
    .filter((model) => validateModelForGroup(model, group, strictCapabilities, zdr).ok)
    .filter((model) => !q || model.id.toLowerCase().includes(q) || model.name.toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, limit)
}

export function validateOverrides(
  catalog: OpenRouterModel[],
  overrides: Record<string, string>,
  strictCapabilities = true,
  zdr: ZdrIndex | null = null,
): { ok: boolean; errors: Record<string, ModelRejection[]>; snapshot: Record<string, OpenRouterModel> } {
  const errors: Record<string, ModelRejection[]> = {}
  const snapshot: Record<string, OpenRouterModel> = {}
  for (const [groupId, modelId] of Object.entries(overrides)) {
    const group = AGENT_GROUPS.find((g) => g.id === groupId)
    if (!group) {
      errors[groupId] = [{ code: 'unknown_group', message: 'unknown agent group' }]
      continue
    }
    const model = catalog.find((m) => m.id === modelId)
    if (!model) {
      errors[groupId] = [
        {
          code: 'not_in_catalog',
          message: `model '${modelId}' not found in the model catalog`,
          params: { model: modelId },
        },
      ]
      continue
    }
    const validation = validateModelForGroup(model, group, strictCapabilities, zdr)
    if (!validation.ok) {
      errors[groupId] = validation.reasons
      continue
    }
    snapshot[groupId] = model
  }
  return { ok: Object.keys(errors).length === 0, errors, snapshot }
}
