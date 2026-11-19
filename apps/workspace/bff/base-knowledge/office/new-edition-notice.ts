import 'server-only'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { withTenant } from '@/lib/db/tenant-context'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { openRecipientsOfGroup } from '@/lib/inbox/repository'
import { emitInboxItems, resolveInboxItemsOfType, type InboxEmission } from '@/lib/inbox/service'
import { activeMembersHolding } from '@/lib/organizations/members-holding'
import { listProjectsInOrg } from '@/lib/projects/repository'
import { knowledgeContextForTurn } from '../context/service'
import { designationKey } from '../platform'
import type { StoredEntry } from '../store/repository'
import type { BindingStanding } from '../wire'
import { officeStandardsEnabled } from './access'
import { bindingNormsOf, bindingStanding, type BindingNorms } from './binding-edition'
import { listOrganizationsWithOfficeEditions } from './repository'
import { heldWorksOf } from './service'
import { newestOf } from './work-editions'
import { workDesignation } from './work-designation'

export const NEW_EDITION_NOTICE = 'base_knowledge.new_edition' as const

export const NEW_EDITION_MAX_ORGANIZATIONS = 1000

export const NEW_EDITION_MAX_PROJECTS = 200

const NAMED_PROJECTS = 5

export interface ProjectBindings {
  name: string
  bindings: BindingNorms
}

export interface AffectedNorm {
  anchorId: string
  subject: string
  entryId: string
  standing: BindingStanding
  projects: string[]
}

export function affectedNorms(works: readonly (readonly StoredEntry[])[], projects: readonly ProjectBindings[]): AffectedNorm[] {
  const affected = new Map<string, AffectedNorm>()
  for (const editions of works) {
    const newest = newestOf(editions.filter((entry) => entry.confirmed))
    const designation = workDesignation(newest?.values.designation ?? null)
    if (!newest || !designation) continue
    const key = designationKey(designation)
    for (const project of projects) {
      const standing = bindingStanding(editions, project.bindings.get(key))
      if (!standing?.newer) continue
      const anchorId = `${key}@${standing.startsOn ?? standing.editionLabel}`
      const norm = affected.get(anchorId) ?? { anchorId, subject: newest.values.designation ?? designation, entryId: newest.editionId, standing, projects: [] }
      norm.projects.push(project.name)
      affected.set(anchorId, norm)
    }
  }
  return [...affected.values()]
}

function excerptOf(names: readonly string[]): string {
  const shown = names.slice(0, NAMED_PROJECTS).join(', ')
  return names.length > NAMED_PROJECTS ? `${shown} …` : shown
}

function viaOf({ via }: BindingStanding): string | null {
  return [via?.designation, via?.editionLabel].filter(Boolean).join(' ') || null
}

interface ActiveProjectBindings {
  projects: ProjectBindings[]
  unread: number
}

async function activeProjectBindings(organizationId: string): Promise<ActiveProjectBindings> {
  const active = (await listProjectsInOrg(organizationId)).filter((project) => project.status === 'active')
  if (active.length > NEW_EDITION_MAX_PROJECTS) {
    console.warn(`[base-knowledge] ${organizationId}: only ${NEW_EDITION_MAX_PROJECTS} of ${active.length} active projects are compared`)
  }
  const projects: ProjectBindings[] = []
  let unread = 0
  for (const project of active.slice(0, NEW_EDITION_MAX_PROJECTS)) {
    const context = await knowledgeContextForTurn(organizationId, project.id, undefined, null, 'run')
    if (context.gate.state === 'knowledge_unavailable') unread += 1
    else projects.push({ name: project.name, bindings: bindingNormsOf(context.uses) })
  }
  return { projects, unread }
}

async function openNotices(organizationId: string, groupKeys: readonly string[], recipients: number): Promise<Set<string>> {
  const open = new Set<string>()
  for (const groupKey of groupKeys) {
    for (const recipientUserId of await openRecipientsOfGroup(organizationId, groupKey, recipients)) open.add(`${recipientUserId}\n${groupKey}`)
  }
  return open
}

export interface NewEditionOutcome {
  newer: number
  notified: number
  resolved: number
}

export async function noticeNewEditions(organizationId: string): Promise<NewEditionOutcome> {
  const works = await heldWorksOf(organizationId)
  const read = works.length > 0 ? await activeProjectBindings(organizationId) : { projects: [], unread: 0 }
  const affected = affectedNorms(works, read.projects)
  if (read.unread > 0) {
    console.warn(`[base-knowledge] ${organizationId}: the knowledge context of ${read.unread} active project(s) could not be read; open new-edition notices are kept`)
  }
  const resolved = read.unread > 0
    ? 0
    : await resolveInboxItemsOfType({
        organizationId,
        types: [NEW_EDITION_NOTICE],
        keepAnchors: affected.map((norm) => norm.anchorId),
      })
  if (affected.length === 0) return { newer: 0, notified: 0, resolved }
  const recipients = await activeMembersHolding(organizationId, ORG_PERMISSIONS.officeShelfManage)
  if (recipients.length === 0) {
    console.warn(`[base-knowledge] ${organizationId} holds ${affected.length} norm(s) no longer binding for its projects, and nobody manages its Büroablage`)
    return { newer: affected.length, notified: 0, resolved }
  }
  const candidates = affected.flatMap((norm) => {
    const groupKey = inboxGroupKey(NEW_EDITION_NOTICE, 'organization', organizationId, norm.anchorId)
    return recipients.map((recipientUserId) => ({ norm, groupKey, recipientUserId }))
  })
  const open = await openNotices(organizationId, [...new Set(candidates.map((candidate) => candidate.groupKey))], recipients.length)
  const emissions: InboxEmission[] = candidates
    .filter((candidate) => !open.has(`${candidate.recipientUserId}\n${candidate.groupKey}`))
    .map(({ norm, groupKey, recipientUserId }) => {
      const via = viaOf(norm.standing)
      return {
        organizationId,
        recipientUserId,
        type: NEW_EDITION_NOTICE,
        resourceType: 'organization',
        resourceId: organizationId,
        anchorId: norm.anchorId,
        actorUserId: null,
        groupKey,
        payload: {
          subject: norm.subject,
          entryId: norm.entryId,
          related: norm.standing.editionLabel,
          excerpt: excerptOf(norm.projects),
          ...(via ? { variant: 'via', via } : {}),
        },
      }
    })
  if (emissions.length > 0) await emitInboxItems(emissions)
  return { newer: affected.length, notified: emissions.length, resolved }
}

export interface NewEditionSweep {
  organizations: number
  notified: number
  resolved: number
  failed: number
}

export async function sweepNewEditionNotices(): Promise<NewEditionSweep> {
  const organizations = await listOrganizationsWithOfficeEditions(NEW_EDITION_MAX_ORGANIZATIONS)
  if (organizations.length >= NEW_EDITION_MAX_ORGANIZATIONS) {
    console.warn(`[base-knowledge] new editions: the cap of ${NEW_EDITION_MAX_ORGANIZATIONS} organizations was reached; the rest are not compared`)
  }
  const sweep: NewEditionSweep = { organizations: organizations.length, notified: 0, resolved: 0, failed: 0 }
  for (const organizationId of organizations) {
    try {
      if (!(await officeStandardsEnabled(organizationId))) {
        sweep.resolved += await withTenant({ organizationId }, () => resolveInboxItemsOfType({ organizationId, types: [NEW_EDITION_NOTICE] }))
        continue
      }
      const outcome = await withTenant({ organizationId }, () => noticeNewEditions(organizationId))
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
