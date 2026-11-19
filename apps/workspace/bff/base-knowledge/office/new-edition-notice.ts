import 'server-only'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { withTenant } from '@/lib/db/tenant-context'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { readGroupPayloads } from '@/lib/inbox/repository'
import { emitInboxItems, resolveInboxItemsAnchoredOn, type InboxEmission } from '@/lib/inbox/service'
import { activeMembersHolding } from '@/lib/organizations/members-holding'
import { salvageProjectProfile } from '@/lib/project-profile/salvage'
import { listProjectsInOrg } from '@/lib/projects/repository'
import { referenceDayOfProfile } from '../time/profile-procedure'
import { listOrganizationsWithOfficeEditions } from './repository'
import { directoryStandingsOf, type WorkStanding } from './service'
import { designationKey } from './work-designation'

export const NEW_EDITION_NOTICE = 'base_knowledge.new_edition' as const

export const NEW_EDITION_MAX_ORGANIZATIONS = 1000

const NAMED_PROJECTS = 5

type ProfileFacts = Parameters<typeof referenceDayOfProfile>[0]

export interface ProjectDay {
  name: string
  status: string
  facts: ProfileFacts
}

export function newEditionAnchor(work: WorkStanding): string {
  return `${designationKey(work.designation)}@${work.standing.inForce.startsOn}`
}

export function projectsAfter(projects: readonly ProjectDay[], startsOn: string, today: string): string[] {
  return projects
    .filter((project) => project.status === 'active' && referenceDayOfProfile(project.facts, today) >= startsOn)
    .map((project) => project.name)
}

function excerptOf(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined
  const shown = names.slice(0, NAMED_PROJECTS).join(', ')
  return names.length > NAMED_PROJECTS ? `${shown} …` : shown
}

export interface NewEditionOutcome {
  newer: number
  notified: number
  resolved: number
}

export async function noticeNewEditions(organizationId: string, now: Date = new Date()): Promise<NewEditionOutcome> {
  const standings = await directoryStandingsOf(organizationId, now)
  let resolved = 0
  for (const work of standings.filter((candidate) => candidate.standing.held)) {
    resolved += await resolveInboxItemsAnchoredOn({ organizationId, types: [NEW_EDITION_NOTICE], anchorId: newEditionAnchor(work) })
  }
  const newer = standings.filter((candidate) => !candidate.standing.held)
  if (newer.length === 0) return { newer: 0, notified: 0, resolved }
  const recipients = await activeMembersHolding(organizationId, ORG_PERMISSIONS.officeShelfManage)
  if (recipients.length === 0) {
    console.warn(`[base-knowledge] ${organizationId} holds ${newer.length} work(s) with a newer edition in force, and nobody manages its Büroablage`)
    return { newer: newer.length, notified: 0, resolved }
  }
  const candidates = newer.flatMap((work) => {
    const anchorId = newEditionAnchor(work)
    const groupKey = inboxGroupKey(NEW_EDITION_NOTICE, 'organization', organizationId, anchorId)
    return recipients.map((recipientUserId) => ({ work, anchorId, groupKey, recipientUserId }))
  })
  const stamped = await readGroupPayloads(organizationId, candidates)
  const owed = candidates.filter((candidate) => !stamped.has(`${candidate.recipientUserId}\n${candidate.groupKey}`))
  if (owed.length === 0) return { newer: newer.length, notified: 0, resolved }
  const today = now.toISOString().slice(0, 10)
  const projects = (await listProjectsInOrg(organizationId)).map((project) => ({
    name: project.name,
    status: project.status,
    facts: salvageProjectProfile(project.profile).profile?.facts ?? {},
  }))
  const emissions: InboxEmission[] = owed.map(({ work, anchorId, groupKey, recipientUserId }) => {
    const excerpt = excerptOf(projectsAfter(projects, work.standing.inForce.startsOn, today))
    return {
      organizationId,
      recipientUserId,
      type: NEW_EDITION_NOTICE,
      resourceType: 'organization',
      resourceId: organizationId,
      anchorId,
      actorUserId: null,
      groupKey,
      payload: {
        subject: work.designation,
        related: work.standing.inForce.editionLabel,
        startsOn: work.standing.inForce.startsOn,
        ...(excerpt ? { variant: 'projects', excerpt } : {}),
      },
    }
  })
  await emitInboxItems(emissions)
  return { newer: newer.length, notified: emissions.length, resolved }
}

export interface NewEditionSweep {
  organizations: number
  notified: number
  resolved: number
  failed: number
}

export async function sweepNewEditionNotices(now: Date = new Date()): Promise<NewEditionSweep> {
  const organizations = await listOrganizationsWithOfficeEditions(NEW_EDITION_MAX_ORGANIZATIONS)
  if (organizations.length >= NEW_EDITION_MAX_ORGANIZATIONS) {
    console.warn(`[base-knowledge] new editions: the cap of ${NEW_EDITION_MAX_ORGANIZATIONS} organizations was reached; the rest are not compared`)
  }
  const sweep: NewEditionSweep = { organizations: organizations.length, notified: 0, resolved: 0, failed: 0 }
  for (const organizationId of organizations) {
    try {
      const outcome = await withTenant({ organizationId }, () => noticeNewEditions(organizationId, now))
      sweep.notified += outcome.notified
      sweep.resolved += outcome.resolved
    } catch (error) {
      sweep.failed += 1
      console.warn(`[base-knowledge] could not compare the editions of ${organizationId}:`, error)
    }
  }
  if (sweep.failed > 0) throw new Error(`new editions: ${sweep.failed} of ${organizations.length} organization(s) failed`)
  return sweep
}
