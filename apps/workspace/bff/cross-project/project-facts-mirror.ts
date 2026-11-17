import 'server-only'
import { currentRestrictedCollections } from '@/lib/authz/folder-access'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { Project } from '@/lib/db/schema/projects'
import { findProjectInOrg, listProjectFactsPage, type ProjectFactsRow } from '@/lib/projects/repository'
import { toProjectStatus, type ProjectStatus } from '@/lib/projects/project-status'
import { buildRequestContextWireHeaders } from '@/lib/request-context'
import { SIMILARITY_WEIGHTS, similarityFacts } from './similarity'

export interface ProjectFactsWire {
  federal_state: string | null
  building_class: number[]
  construction_method: string[]
  uses: string[]
  work_type: string[]
}

export interface ProjectFactsUpdateWire {
  facts: ProjectFactsWire
  status: ProjectStatus
}

const WEIGHT_WIRE_NAMES: { readonly [K in keyof typeof SIMILARITY_WEIGHTS]: string } = {
  federalState: 'federal_state',
  buildingClass: 'building_class',
  buildingClassAdjacent: 'building_class_adjacent',
  constructionMethod: 'construction_method',
  use: 'use',
  useMax: 'use_max',
  workType: 'work_type',
}

export interface SearchBoostWire {
  facts: ProjectFactsWire
  weights: Record<string, number>
}

type Profile = Project['profile'] | null

export const PROJECT_FACTS_LIMITS = {
  token: 80,
  building_class: 20,
  construction_method: 20,
  uses: 40,
  work_type: 20,
} as const

function wireTokens(values: readonly string[], max: number): string[] {
  return values.filter((value) => value.length <= PROJECT_FACTS_LIMITS.token).slice(0, max)
}

export function projectFactsOf(profile: Profile): ProjectFactsWire {
  const facts = similarityFacts(profile)
  const limits = PROJECT_FACTS_LIMITS
  return {
    federal_state: facts.federal_state && facts.federal_state.length <= limits.token ? facts.federal_state : null,
    building_class: facts.building_class.slice(0, limits.building_class),
    construction_method: wireTokens(facts.construction_method, limits.construction_method),
    uses: wireTokens(facts.uses, limits.uses),
    work_type: wireTokens(facts.work_type, limits.work_type),
  }
}

export function projectFactsUpdateOf(project: Pick<Project, 'profile' | 'status'>): ProjectFactsUpdateWire {
  return { facts: projectFactsOf(project.profile), status: toProjectStatus(project.status) }
}

export function similarityBoostOf(profile: Profile): SearchBoostWire | null {
  const facts = projectFactsOf(profile)
  const empty =
    facts.federal_state === null &&
    facts.building_class.length + facts.construction_method.length + facts.uses.length + facts.work_type.length === 0
  if (empty) return null
  const weights = Object.fromEntries(
    (Object.keys(WEIGHT_WIRE_NAMES) as Array<keyof typeof SIMILARITY_WEIGHTS>).map((key) => [
      WEIGHT_WIRE_NAMES[key],
      SIMILARITY_WEIGHTS[key],
    ])
  )
  return { facts, weights }
}

const PUSH_TIMEOUT_MS = 3_000

export type PushOutcome = 'pushed' | 'unsupported' | 'failed'

async function putFacts(collection: string, body: ProjectFactsUpdateWire): Promise<PushOutcome> {
  try {
    const res = await fetch(`${getBackendUrl()}/v1/collections/${encodeURIComponent(collection)}/project-facts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...buildRequestContextWireHeaders({ collectionScope: [collection] }, process.env.INTERNAL_API_TOKEN),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    })
    if (res.ok) return 'pushed'
    if (res.status === 409) return 'unsupported'
    console.warn('[ProjectFacts] backend refused the facts of', collection, res.status)
    return 'failed'
  } catch (error) {
    console.warn('[ProjectFacts] could not push the facts of', collection, error)
    return 'failed'
  }
}

export async function pushProjectFacts(project: ProjectFactsRow): Promise<PushOutcome> {
  let collections: string[]
  try {
    collections = [
      project.collectionName,
      ...(await currentRestrictedCollections(project.organizationId, project.id, project.collectionName)),
    ]
  } catch (error) {
    console.warn('[ProjectFacts] could not name the collections of project', project.id, error)
    return 'failed'
  }
  const body = projectFactsUpdateOf(project)
  const outcomes = await Promise.all(collections.map((collection) => putFacts(collection, body)))
  if (outcomes.includes('unsupported')) return 'unsupported'
  return outcomes.includes('failed') ? 'failed' : 'pushed'
}

export async function syncProjectFacts(organizationId: string, projectId: string): Promise<PushOutcome | null> {
  try {
    const project = await findProjectInOrg(projectId, organizationId)
    return project ? await pushProjectFacts(project) : null
  } catch (error) {
    console.warn('[ProjectFacts] could not read project', projectId, error)
    return 'failed'
  }
}

export async function projectFactsForIngest(
  projectId: string | null | undefined,
  organizationId: string
): Promise<ProjectFactsUpdateWire | null> {
  if (!projectId) return null
  try {
    const project = await findProjectInOrg(projectId, organizationId)
    return project ? projectFactsUpdateOf(project) : null
  } catch {
    return null
  }
}

const SYNC_PAGE = 200

export interface ProjectFactsSyncResult {
  projects: number
  failed: number
  unsupported: boolean
}

export async function syncAllProjectFacts(): Promise<ProjectFactsSyncResult> {
  const result: ProjectFactsSyncResult = { projects: 0, failed: 0, unsupported: false }
  let afterId: string | null = null
  for (;;) {
    const page = await listProjectFactsPage(afterId, SYNC_PAGE)
    for (const project of page) {
      const outcome = await pushProjectFacts(project)
      if (outcome === 'unsupported') return { ...result, unsupported: true }
      result.projects += 1
      if (outcome === 'failed') result.failed += 1
    }
    if (page.length < SYNC_PAGE) return result
    afterId = page[page.length - 1].id
  }
}
