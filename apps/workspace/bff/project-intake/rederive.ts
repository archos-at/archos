/**
 * Every live project's building class derived once more, from the records released since it was written
 * (`docs/design/international/rollover-to-prod.md`, „Existing projects"). The step after a country's setup
 * records are published: a project whose class was derived from the compiled seed, or never derived because
 * its site's law was withheld, gets the class the released records give, as a reading's write would give it
 * (`planRederive`, the same rule as `planRecord`).
 *
 * - The site the knowledge context places the project by (`sitePlacement`, ADR-0158) is recorded where the
 *   profile does not hold it yet, so the setup reads the same site: the Land the stored address names, over
 *   an office default (migration 0018's). A profile with no place recorded at all is left as it is: the
 *   subdivision its office's home country assumes (`assumedWhenUnstated`) places it in the gate and the turn
 *   only, so the office sees no assumption it never made. A recorded Land or country is never replaced.
 * - Law withheld at the site, or no records for its country: nothing is derived and nothing is written. Run
 *   before a country is released, it changes nothing.
 * - Idempotent: a project whose classes would not move is not written, and its version is not bumped.
 * - Closed projects are left as they are.
 *
 * Bounded: pages of {@link PAGE} projects, and it stops at `deadlineMs` with `complete: false`; a second run
 * goes on from the start and writes only what is still behind. Each organization's records are read once.
 * The projects are listed across organizations (`listProjectFactsPage`, platform access) and each one is
 * read and written in its own organization's tenant scope, as the request path does.
 */

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

/** Projects listed per page. */
const PAGE = 100
/** Writes one project tries before it counts as failed: another writer got there between read and write. */
const MAX_WRITE_ATTEMPTS = 3
/** The default bound on one run. */
const DEFAULT_DEADLINE_MS = 15 * 60 * 1000

/** What one run did. */
export interface RederiveResult {
  /** Live projects looked at, closed ones included. */
  projects: number
  /** Projects whose profile was written: a class moved, or the site it is placed by was recorded. */
  written: number
  /** Projects left as they were: nothing moved, law withheld, no records, or closed. */
  unchanged: number
  /** Projects whose read or write failed; logged one by one. */
  failed: number
  /** False when the deadline stopped the run before the last page. */
  complete: boolean
}

interface OfficeSetup {
  records: readonly StoredRuleset[]
  assumed: AssumedSubdivision | null
}

/**
 * The profile with the site the knowledge context places it by recorded, where only the address or the
 * office's default places it (`sitePlacement` steps `address` and `office_default`); the profile itself
 * (the same object) otherwise. Pure.
 */
export function withPlacementRecorded(stored: ProjectProfile, office: OfficeSetup, now: Date): ProjectProfile {
  const placement = sitePlacement(stored, subdivisionTerritories(office.records), office.assumed?.territoryId ?? null)
  // The office default places a project with nothing recorded only in the gate and the turn: writing it
  // into the profile would show the office a new assumption it never made (the owner's rule for this
  // release: customers notice nothing). Only an address the project already holds is recorded.
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

/** One project's classes derived again and written when they moved. */
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

/**
 * Derive every live project's building classes again (see the module header). Call it after a country's
 * setup records are published: `rederiveBuildingClasses()` from the jobs bundle, or
 * `bun run rederive:building-classes` (`workers/rederive-building-classes.js`).
 */
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
