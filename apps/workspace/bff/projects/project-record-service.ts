import { officeMonth } from '@/lib/organizations/time-zone'
import 'server-only'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'
import { isUserInOrganization } from '@/lib/authz/project-membership'
import { recordAuditEvent } from '@/lib/audit/service'
import type { ProjectPersonRow } from '@/lib/db/schema/project-people'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { findProjectProfile } from './repository'
import { projectSiteAddress } from './site-address'
import { dateToMonth, isOrderedPeriod, monthToDate, type Month } from './month'
import { closingOf, isProjectClosed, projectClosedError } from './project-status'
import { loadProjectTeam } from './project-team'
import {
  deleteProjectPersonRow,
  findProjectPeriod,
  findProjectPersonByUser,
  insertProjectPerson,
  listProjectPeople,
  updateProjectPeriod,
  updateProjectPersonRow,
  type ProjectPeriodRow,
  type ProjectPersonValues,
} from './project-record-repository'
import { mergePeople } from './project-record-people'
import type { ProjectPeriodInput, ProjectPersonInput, ProjectPersonView, ProjectRecordView } from './project-record-types'

const PROJECT_RECORD_WRITE: readonly ProjectPermission[] = ['project:memory:write', 'project:edit']

const toDate = (month: Month | null): string | null => (month ? monthToDate(month) : null)

async function mayWrite(session: AuthorizedSession, projectId: string): Promise<boolean> {
  return requireProjectAccess(session, projectId, PROJECT_RECORD_WRITE).then(
    () => true,
    () => false
  )
}

async function mayErase(session: AuthorizedSession, projectId: string, closed: boolean): Promise<boolean> {
  if (!closed) return mayWrite(session, projectId)
  return requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true }).then(
    () => true,
    () => false
  )
}

function personView(row: ProjectPersonRow): ProjectPersonView {
  return mergePeople([row], null)[0]
}

function startOf(period: ProjectPeriodRow): { startedOn: Month | null; isDefault: boolean } {
  const set = dateToMonth(period.startedOn)
  if (set) return { startedOn: set, isDefault: false }
  const created = dateToMonth(period.createdAt)
  const usable = created && isOrderedPeriod(created, dateToMonth(closingOf(period)))
  return usable ? { startedOn: created, isDefault: true } : { startedOn: null, isDefault: false }
}

function addressOf(profile: Awaited<ReturnType<typeof findProjectProfile>>): string | null {
  return profile ? projectSiteAddress({ profile }) : null
}

export async function getProjectRecord(session: AuthorizedSession, projectId: string): Promise<ProjectRecordView> {
  const { closed } = await requireProjectAccess(session, projectId, 'project:view')
  const [period, profile, rows, team, canEdit, canErase] = await Promise.all([
    findProjectPeriod(projectId, session.organizationId),
    findProjectProfile(projectId, session.organizationId),
    listProjectPeople(projectId, session.organizationId),
    loadProjectTeam(projectId, session.organizationId),
    mayWrite(session, projectId),
    mayErase(session, projectId, closed),
  ])
  if (!period) throw new NotFoundError()
  const start = startOf(period)
  return {
    address: addressOf(profile),
    startedOn: start.startedOn,
    startedOnIsDefault: start.isDefault,
    endedOn: dateToMonth(closingOf(period)),
    people: mergePeople(rows, team),
    rosterKnown: team !== null,
    canEdit,
    canErase,
  }
}

export async function setProjectPeriod(
  session: AuthorizedSession,
  projectId: string,
  input: ProjectPeriodInput,
  request?: Request
): Promise<{ startedOn: Month | null }> {
  await requireProjectAccess(session, projectId, PROJECT_RECORD_WRITE)
  const row = await updateProjectPeriod(projectId, session.organizationId, toDate(input.startedOn))
  if (!row) {
    if (isProjectClosed(await findProjectPeriod(projectId, session.organizationId))) throw projectClosedError()
    throw new NotFoundError()
  }
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.period.changed',
    targetType: 'project',
    targetId: projectId,
    metadata: { startedOn: input.startedOn ?? '' },
    request,
  })
  return { startedOn: dateToMonth(row.startedOn) }
}

async function personValues(session: AuthorizedSession, input: ProjectPersonInput): Promise<ProjectPersonValues> {
  if (input.userId && !(await isUserInOrganization(session, input.userId))) {
    throw new BadRequestError('The linked account is not a member of this organization.', { reason: 'unknown-account' })
  }
  return {
    name: input.name,
    function: input.function,
    company: input.company,
    startedOn: toDate(input.startedOn),
    endedOn: toDate(input.endedOn),
    userId: input.userId,
  }
}

async function auditPerson(
  session: AuthorizedSession,
  projectId: string,
  action: 'project.person.added' | 'project.person.updated' | 'project.person.deleted',
  personId: string,
  request?: Request
): Promise<void> {
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action,
    targetType: 'project',
    targetId: projectId,
    metadata: { personId },
    request,
  })
}

export async function addProjectPerson(
  session: AuthorizedSession,
  projectId: string,
  input: ProjectPersonInput,
  request?: Request
): Promise<ProjectPersonView> {
  await requireProjectAccess(session, projectId, PROJECT_RECORD_WRITE)
  const values = await personValues(session, input)
  const existing = values.userId ? await findProjectPersonByUser(projectId, session.organizationId, values.userId) : null
  if (existing) return updateProjectPerson(session, projectId, existing.id, input, request)
  const row = await insertProjectPerson(projectId, session.organizationId, session.userId, values)
  await auditPerson(session, projectId, 'project.person.added', row.id, request)
  return personView(row)
}

export async function updateProjectPerson(
  session: AuthorizedSession,
  projectId: string,
  personId: string,
  input: ProjectPersonInput,
  request?: Request
): Promise<ProjectPersonView> {
  await requireProjectAccess(session, projectId, PROJECT_RECORD_WRITE)
  const row = await updateProjectPersonRow(projectId, session.organizationId, personId, await personValues(session, input))
  if (!row) throw new NotFoundError('Person not found')
  await auditPerson(session, projectId, 'project.person.updated', row.id, request)
  return personView(row)
}

export async function deleteProjectPerson(
  session: AuthorizedSession,
  projectId: string,
  personId: string,
  request?: Request
): Promise<void> {
  const { closed } = await requireProjectAccess(session, projectId, 'project:view')
  if (closed) {
    await requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true })
  } else {
    await requireProjectAccess(session, projectId, PROJECT_RECORD_WRITE)
  }
  if (!(await deleteProjectPersonRow(projectId, session.organizationId, personId))) {
    throw new NotFoundError('Person not found')
  }
  await auditPerson(session, projectId, 'project.person.deleted', personId, request)
}

export async function recordMemberLeft(
  session: AuthorizedSession,
  projectId: string,
  member: { userId: string; since: Month | null }
): Promise<void> {
  try {
    const period = await findProjectPeriod(projectId, session.organizationId)
    if (!period || isProjectClosed(period)) return
    const left = await officeMonth(session.organizationId)
    const row = await findProjectPersonByUser(projectId, session.organizationId, member.userId)
    if (row) {
      if (row.endedOn || !isOrderedPeriod(dateToMonth(row.startedOn), left)) return
      await updateProjectPersonRow(projectId, session.organizationId, row.id, { ...valuesOf(row), endedOn: monthToDate(left) })
      await auditPerson(session, projectId, 'project.person.updated', row.id)
      return
    }
    const name = (await loadOrganizationDirectory(session.organizationId)).get(member.userId)?.name
    if (!name) return
    const since = member.since && isOrderedPeriod(member.since, left) ? member.since : null
    const added = await insertProjectPerson(projectId, session.organizationId, session.userId, {
      name,
      function: null,
      company: null,
      startedOn: toDate(since),
      endedOn: monthToDate(left),
      userId: member.userId,
    })
    await auditPerson(session, projectId, 'project.person.added', added.id)
  } catch (error) {
    console.warn(`[project-record] could not keep ${projectId}'s departing member:`, error)
  }
}

export async function recordMemberRejoined(session: AuthorizedSession, projectId: string, userId: string): Promise<void> {
  try {
    const row = await findProjectPersonByUser(projectId, session.organizationId, userId)
    if (!row?.endedOn) return
    if (!(await updateProjectPersonRow(projectId, session.organizationId, row.id, { ...valuesOf(row), endedOn: null }))) return
    await auditPerson(session, projectId, 'project.person.updated', row.id)
  } catch (error) {
    console.warn(`[project-record] could not reopen ${projectId}'s returning member:`, error)
  }
}

function valuesOf(row: ProjectPersonRow): ProjectPersonValues {
  return {
    name: row.name,
    function: row.function,
    company: row.company,
    startedOn: row.startedOn,
    endedOn: row.endedOn,
    userId: row.userId,
  }
}
