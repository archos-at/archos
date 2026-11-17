import 'server-only'
import { AGENT_GROUPS, getAgentGroup } from './agent-groups'
import { getGroupDefaultSources, splitGroupDefault, type GroupDefaultSource } from './backend-defaults'
import { fetchZdrEndpoints, zdrShortfall, type ZdrIndex, type ZdrShortfall } from './openrouter'
import { getActiveModelOverrides, layerOrgOverrides } from './service'

export type EffectiveModelSource = 'org' | 'platform' | 'workflow'

export interface EffectiveGroupModel {
  group: string
  modelIds: string[]
  source: EffectiveModelSource | null
}

export interface ZdrBlockedGroup {
  group: string
  modelId: string
  source: EffectiveModelSource
  reason: ZdrShortfall
}

export interface ZdrCoverage {
  status: 'checked' | 'unknown'
  blockedGroups: ZdrBlockedGroup[]
  unresolvedGroups: string[]
}

export const UNKNOWN_COVERAGE: ZdrCoverage = { status: 'unknown', blockedGroups: [], unresolvedGroups: [] }

export function resolveEffectiveGroupModels(
  orgOverrides: Record<string, string> | null,
  inherited: Record<string, GroupDefaultSource>
): EffectiveGroupModel[] {
  const inheritedModels = Object.fromEntries(
    Object.entries(inherited)
      .filter((entry): entry is [string, GroupDefaultSource & { model: string }] => entry[1].model !== null)
      .map(([group, { model }]) => [group, model])
  )
  const effective = layerOrgOverrides(inheritedModels, orgOverrides)
  return AGENT_GROUPS.map(({ id }) => {
    const source: EffectiveModelSource | null = orgOverrides?.[id] ? 'org' : (inherited[id]?.source ?? null)
    return { group: id, modelIds: splitGroupDefault(effective[id]), source: source && effective[id] ? source : null }
  })
}

export function findZdrBlockedGroups(models: EffectiveGroupModel[], zdr: ZdrIndex): ZdrBlockedGroup[] {
  const blocked: ZdrBlockedGroup[] = []
  for (const { group: groupId, modelIds, source } of models) {
    const group = getAgentGroup(groupId)
    if (!group || !source) continue
    for (const modelId of modelIds) {
      const reason = zdrShortfall(modelId, group, zdr)
      if (reason) blocked.push({ group: groupId, modelId, source, reason })
    }
  }
  return blocked
}

export async function getZdrCoverage(organizationId: string): Promise<ZdrCoverage> {
  const [orgOverrides, inherited] = await Promise.all([
    getActiveModelOverrides(organizationId),
    getGroupDefaultSources(),
  ])
  const models = resolveEffectiveGroupModels(orgOverrides, inherited)
  const unresolvedGroups = models.filter((model) => model.source === null).map((model) => model.group)
  let zdr: ZdrIndex
  try {
    zdr = await fetchZdrEndpoints()
  } catch (error) {
    console.warn('[Model Config] ZDR coverage unknown: the ZDR list could not be read:', error)
    return { ...UNKNOWN_COVERAGE, unresolvedGroups }
  }
  return { status: 'checked', blockedGroups: findZdrBlockedGroups(models, zdr), unresolvedGroups }
}
