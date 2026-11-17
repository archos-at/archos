import 'server-only'
import { getCached } from '@/lib/cache'
import {
  getActiveCredentialProvider,
  resolveActiveCredentialForBackend,
  type ResolvedCredential,
} from '@/lib/llm-credentials/service'
import { MODEL_ID_PATTERN } from './agent-groups'
import { fetchModelCatalog, fetchZdrEndpoints, type OpenRouterModel, type ZdrIndex } from './openrouter'

const BYOK_CATALOG_TTL_MS = 5 * 60 * 1000
const BYOK_LIST_TIMEOUT_MS = 8_000

export interface OrgModelCatalog {
  models: OpenRouterModel[]
  source: 'openrouter' | 'byok'
  provider: string | null
  validation: 'full' | 'listed'
  zdrOnly: boolean
  zdrApplicable: boolean
  zdr: ZdrIndex | null
}

export interface OrgCatalogOptions {
  zdrOnly?: boolean
}

function toBareModel(id: string): OpenRouterModel {
  return {
    id,
    name: id,
    contextLength: 0,
    promptPrice: 0,
    completionPrice: 0,
    inputModalities: [],
    supportedParameters: [],
  }
}

async function fetchProviderModelList(credential: ResolvedCredential): Promise<string[]> {
  const response = await fetch(`${credential.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${credential.apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(BYOK_LIST_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`BYOK provider model listing failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as { data?: unknown[] }
  const ids = (body.data ?? [])
    .map((entry) =>
      entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id
        : null,
    )
    .filter((id): id is string => id !== null && MODEL_ID_PATTERN.test(id))
  if (ids.length === 0) {
    throw new Error('BYOK provider model listing contained no models')
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

export function isZdrApplicableForCredential(credential: Pick<ResolvedCredential, 'provider'> | null): boolean {
  return !credential || credential.provider === 'openrouter'
}

export async function isZdrApplicableForOrg(organizationId: string): Promise<boolean> {
  const provider = await getActiveCredentialProvider(organizationId)
  return isZdrApplicableForCredential(provider === null ? null : { provider })
}

export async function getCatalogForOrg(
  organizationId: string,
  options: OrgCatalogOptions = {},
): Promise<OrgModelCatalog> {
  const wantZdr = options.zdrOnly === true
  const credential = await resolveActiveCredentialForBackend(organizationId)

  if (!credential || credential.provider === 'openrouter') {
    const [models, zdr] = await Promise.all([fetchModelCatalog(), wantZdr ? fetchZdrEndpoints() : null])
    return {
      models,
      source: credential ? 'byok' : 'openrouter',
      provider: credential ? 'openrouter' : null,
      validation: 'full',
      zdrOnly: wantZdr,
      zdrApplicable: true,
      zdr,
    }
  }

  const cacheKey = `orgmodelcatalog:${organizationId}:${credential.id}`
  const ids = await getCached(cacheKey, BYOK_CATALOG_TTL_MS, async () => fetchProviderModelList(credential))
  return {
    models: ids.map(toBareModel),
    source: 'byok',
    provider: credential.provider,
    validation: 'listed',
    zdrOnly: false,
    zdrApplicable: false,
    zdr: null,
  }
}
