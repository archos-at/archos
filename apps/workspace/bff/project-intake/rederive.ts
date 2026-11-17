import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import { readOrganizationCountries } from '@/lib/base-knowledge/platform/entitlements'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { normalizeLegacyProfile } from '@/lib/project-profile/legacy-names'
import { seedProjectProfile } from '@/lib/project-profile/profile-service'
import { sitePlacement } from '@/lib/base-knowledge/context/site'
import { postalCodeSuggestion } from '@/lib/projects/intake-seed'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { findProjectProfileInOrg, listProjectFactsPage } from '@/lib/projects/repository'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { lawWithheldAt } from './classification'
import { planRederive } from './record'
import { readSetupRecords } from './setup-records'
import { assumedSubdivisionOf, subdivisionTerritories, type AssumedSubdivision } from './setup-scope'

const PAGE = 100
const MAX_WRITE_ATTEMPTS = 3
const DEFAULT_DEADLINE_MS = 15 * 60 * 1000

export interface RederiveResult {
  projects: number
  written: number
  unchanged: number
  failed: number
  complete: boolean
}

interface OfficeSetup {
  records: readonly StoredRuleset[]
  assumed: AssumedSubdivision | null
}

export function withPlacementRecorded(stored: ProjectProfile, office: OfficeSetup, now: Date): ProjectProfile {
  const placement = sitePlacement(stored, subdivisionTerritories(office.records), office.assumed?.territoryId ?? null)
  if (placement?.step !== 'address') return stored
  const address = stored.facts.site_address?.value ?? stored.assumptions.site_address?.value
  const suggested = typeof address === 'string' ? postalCodeSuggestion(address, now) : null
  return suggested ? { ...stored, assumptions: { ...stored.assumptions, federal_state: suggested } } : stored
}

type Outcome = 'written' | 'unchanged'

async function officeSetup(organizationId: string): Promise<OfficeSetup> {
  const [records, countries] = await Promise.all([readSetupRecords(organizationId), readOrganizationCountries(organizationId)])
  return { records, assumed: assumedSubdivisionOf(records, countries.homeCountry) }
}

export async function rederiveProject(organizationId: string, projectId: string, office: OfficeSetup, now: Date): Promise<Outcome> {
  const lawWithheld = await lawWithheldAt(organizationId, projectId)
  if (lawWithheld) return 'unchanged'
  for (let attempt = 1; ; attempt += 1) {
    const state = await findProjectProfileInOrg(projectId, organizationId)
    if (!state) return 'unchanged'
    const stored = normalizeLegacyProfile(state.profile) as ProjectProfile
    const placed = withPlacementRecorded(stored, office, now)
    const plan = planRederive(placed, projectIntakeDefinitionV1, { now: now.toISOString(), records: office.records, lawWithheld })
    if (placed === stored && plan.changedKeys.length === 0) return 'unchanged'
    try {
      await seedProjectProfile({ ...state, id: projectId, organizationId }, plan.profile)
      return 'written'
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt >= MAX_WRITE_ATTEMPTS) throw error
    }
  }
}

export async function rederiveBuildingClasses(options: { deadlineMs?: number; now?: () => Date } = {}): Promise<RederiveResult> {
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS)
  const clock = options.now ?? (() => new Date())
  const offices = new Map<string, Promise<OfficeSetup>>()
  const result: RederiveResult = { projects: 0, written: 0, unchanged: 0, failed: 0, complete: false }
  let afterId: string | null = null
  for (;;) {
    if (Date.now() >= deadline) return result
    const page = await listProjectFactsPage(afterId, PAGE)
    for (const project of page) {
      result.projects += 1
      if (project.status === 'closed') {
        result.unchanged += 1
        continue
      }
      try {
        if (!offices.has(project.organizationId)) offices.set(project.organizationId, officeSetup(project.organizationId))
        const office = await (offices.get(project.organizationId) as Promise<OfficeSetup>)
        result[await rederiveProject(project.organizationId, project.id, office, clock())] += 1
      } catch (error) {
        result.failed += 1
        console.error('[rederive_building_classes] a project could not be derived again', { organizationId: project.organizationId, projectId: project.id, error })
      }
    }
    if (page.length < PAGE) return { ...result, complete: true }
    afterId = page[page.length - 1].id
  }
}
