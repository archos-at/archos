import 'server-only'
import type { ProjectStatus } from '@/lib/projects/project-status'
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from '@/lib/api/errors'
import { recordAuditEvent, recordAuditEventOrThrow } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  atLeast,
  clearanceOf,
  effectiveFolderLevel,
  folderTree,
  isUnderOwnList,
  loadCustomFolderTree,
  readableFoldersOfRestrictedProjects,
  seesEveryFolder,
  type FolderClearance,
  type FolderTree,
} from '@/lib/authz/folder-access'
import { hasPermission, ORG_PERMISSIONS } from '@/lib/authz/permissions'
import type { Document } from '@/lib/db/schema/documents'
import { documentDisplayName } from '@/lib/documents/display-name'
import { getOrgSettings, writeDedicatedOrgSetting } from '@/lib/organizations/service'
import { resolvePeople } from '@/lib/sharing/directory'
import {
  ACCESS_LOG_DEFAULT_LIMIT,
  ACCESS_LOG_MAX_LIMIT,
  DOWNLOAD_LOG_KINDS,
  DOWNLOAD_LOG_MAX_RETENTION_DAYS,
  DOWNLOAD_LOG_MIN_RETENTION_DAYS,
  DOWNLOAD_LOG_RETENTION_SETTING,
  isOpenKind,
  isValidRetentionDays,
  retentionDaysFromSettings,
  type DownloadLogKind,
} from './kinds'
import {
  insertAccessLogEntry,
  listAccessLog,
  type AccessLogCursor,
  type AccessLogFilter,
  type AccessLogRow,
  type ReadableFolders,
} from './repository'

export type LoggedDocument = Pick<
  Document,
  'id' | 'scope' | 'projectId' | 'folderId' | 'filename' | 'displayName' | 'publishedVersionId'
>

export interface RecordAccessOptions {
  versionId?: string | null
}

const NAME_LIMIT = 500

async function isUnderOwnListNow(organizationId: string, doc: LoggedDocument): Promise<boolean> {
  if (doc.scope !== 'project' || !doc.projectId || !doc.folderId) return false
  const folders = await loadCustomFolderTree(organizationId, doc.projectId)
  if (!folders) return false
  return isUnderOwnList(folderTree(folders), doc.folderId)
}

export async function recordDocumentAccess(
  session: AuthorizedSession,
  doc: LoggedDocument,
  kind: DownloadLogKind,
  options: RecordAccessOptions = {}
): Promise<void> {
  let ownList = false
  let decided = false
  try {
    ownList = await isUnderOwnListNow(session.organizationId, doc)
    decided = true
    if (isOpenKind(kind) && !ownList) return
    await insertAccessLogEntry({
      organizationId: session.organizationId,
      userId: session.userId,
      kind,
      scope: doc.scope,
      projectId: doc.scope === 'project' ? doc.projectId : null,
      documentId: doc.id,
      documentName: documentDisplayName(doc).slice(0, NAME_LIMIT),
      versionId: options.versionId ?? doc.publishedVersionId ?? null,
      folderId: doc.scope === 'project' ? doc.folderId : null,
      ownList,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (decided && !ownList) {
      console.warn(`[download-log] could not record a ${kind} of document ${doc.id}: ${detail}`)
      return
    }
    console.error(
      `[download-log] could not record a ${kind} of document ${doc.id} that is or may be under an own list: ${detail}`
    )
    throw new ServiceUnavailableError(
      'This file is in a folder whose access is recorded, and the record could not be written, so it was not released. Try again.',
      { reason: 'download-log-unavailable' }
    )
  }
}

export interface DownloadLogQuery {
  userId?: string
  document?: string
  from?: Date
  to?: Date
  kind?: DownloadLogKind
  cursor?: string
  limit?: number
}

export interface DownloadLogEntry {
  id: string
  occurredAt: string
  userId: string
  person: { name: string; email: string | null } | null
  kind: DownloadLogKind
  access: 'download' | 'open'
  scope: AccessLogRow['scope']
  projectId: string | null
  projectName: string | null
  projectStatus: ProjectStatus | null
  documentId: string
  documentName: string | null
  versionId: string | null
  folderId: string | null
  folderPath: string | null
  ownList: boolean
  nameWithheld: boolean
}

export interface DownloadLogPage {
  entries: DownloadLogEntry[]
  nextCursor: string | null
  retentionDays: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export function encodeCursor(cursor: AccessLogCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.id])).toString('base64url')
}

export function decodeCursor(raw: string): AccessLogCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      const [occurredAt, id] = parsed
      if (CURSOR_TIME.test(occurredAt) && UUID.test(id)) return { occurredAt, id }
    }
  } catch {
    // Falls through to the refusal below: a cursor is opaque, and a damaged one is a bad request.
  }
  throw new BadRequestError('Invalid cursor')
}

function toFilter(organizationId: string, query: DownloadLogQuery): AccessLogFilter {
  const filter: AccessLogFilter = { organizationId }
  if (query.userId) filter.userId = query.userId
  const document = query.document?.trim()
  if (document) {
    if (UUID.test(document)) filter.documentId = document.toLowerCase()
    else filter.documentName = document
  }
  if (query.from) filter.from = query.from
  if (query.to) filter.to = query.to
  if (query.kind) filter.kind = query.kind
  return filter
}

function auditMetadata(filter: AccessLogFilter, continued: boolean) {
  return {
    userId: filter.userId,
    documentId: filter.documentId,
    nameFiltered: filter.documentName ? true : undefined,
    kind: filter.kind,
    from: filter.from?.toISOString(),
    to: filter.to?.toISOString(),
    continued,
  }
}

async function folderReadableBy(
  session: AuthorizedSession,
  rows: readonly AccessLogRow[]
): Promise<(row: AccessLogRow) => boolean> {
  const filed = (row: AccessLogRow): row is AccessLogRow & { projectId: string; folderId: string } =>
    row.scope === 'project' && row.projectId !== null && row.folderId !== null
  const projectIds = [...new Set(rows.filter(filed).map((row) => row.projectId))]
  const trees = new Map<string, FolderTree>()
  for (const projectId of projectIds) {
    const folders = await loadCustomFolderTree(session.organizationId, projectId)
    if (folders) trees.set(projectId, folderTree(folders))
  }
  const gone = (row: AccessLogRow & { projectId: string }) =>
    !trees.has(row.projectId) && row.folderPath === null && row.ownList
  const undecided = new Set(rows.flatMap((row) => (filed(row) && gone(row) ? [row.projectId] : [])))
  if (trees.size === 0 && undecided.size === 0) return () => true
  const clearances = new Map<string, FolderClearance>()
  for (const projectId of new Set([...trees.keys(), ...undecided])) {
    clearances.set(projectId, await clearanceOf(session, projectId))
  }
  return (row) => {
    if (!filed(row)) return true
    const tree = trees.get(row.projectId)
    const clearance = clearances.get(row.projectId)
    if (!tree || !clearance) return !gone(row) || clearance?.seesEverything === true
    return atLeast(effectiveFolderLevel(tree, clearance, row.folderId), 'read')
  }
}

async function readableFoldersOf(session: AuthorizedSession): Promise<ReadableFolders> {
  return {
    folderIds: await readableFoldersOfRestrictedProjects(session),
    recordedListReadable: await seesEveryFolder(session),
  }
}

export async function listDownloadLog(
  session: AuthorizedSession,
  query: DownloadLogQuery,
  request: Request
): Promise<DownloadLogPage> {
  if (!hasPermission(session, ORG_PERMISSIONS.downloadLogView)) throw new ForbiddenError()
  if (query.kind && !DOWNLOAD_LOG_KINDS.includes(query.kind)) throw new BadRequestError('Unknown kind')
  const filter = toFilter(session.organizationId, query)
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? ACCESS_LOG_DEFAULT_LIMIT)), ACCESS_LOG_MAX_LIMIT)

  await recordAuditEventOrThrow({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'download_log.viewed',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: auditMetadata(filter, cursor !== null),
    request,
  })

  const named = filter.documentName ? { ...filter, readable: await readableFoldersOf(session) } : null
  const [rows, settings] = await Promise.all([
    listAccessLog(named ?? filter, cursor, limit + 1),
    getOrgSettings(session.organizationId),
  ])
  const page = rows.slice(0, limit)
  const readable = named ? () => true : await folderReadableBy(session, page)
  const people = await resolvePeople(session.organizationId, [...new Set(page.map((row) => row.userId))])

  return {
    entries: page.map((row) => {
      const person = people.get(row.userId)
      const nameWithheld = !readable(row)
      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        userId: row.userId,
        person: person ? { name: person.name, email: person.email } : null,
        kind: row.kind,
        access: isOpenKind(row.kind) ? 'open' : 'download',
        scope: row.scope,
        projectId: row.projectId,
        projectName: row.projectName,
        projectStatus: row.projectStatus,
        documentId: row.documentId,
        documentName: nameWithheld ? null : row.documentName,
        versionId: row.versionId,
        folderId: row.folderId,
        folderPath: nameWithheld ? null : row.folderPath,
        ownList: row.ownList,
        nameWithheld,
      }
    }),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].cursor) : null,
    retentionDays: retentionDaysFromSettings(settings.settings),
  }
}

export async function getDownloadLogRetentionDays(organizationId: string): Promise<number> {
  return retentionDaysFromSettings((await getOrgSettings(organizationId)).settings)
}

export async function setDownloadLogRetentionDays(
  session: AuthorizedSession,
  days: number,
  request: Request
): Promise<{ days: number; previous: number }> {
  if (!hasPermission(session, ORG_PERMISSIONS.settingsManage)) throw new ForbiddenError()
  if (!isValidRetentionDays(days)) {
    throw new BadRequestError(
      `Retention must be a whole number of days from ${DOWNLOAD_LOG_MIN_RETENTION_DAYS} to ${DOWNLOAD_LOG_MAX_RETENTION_DAYS}`
    )
  }
  const previous = await getDownloadLogRetentionDays(session.organizationId)
  await writeDedicatedOrgSetting(session.organizationId, DOWNLOAD_LOG_RETENTION_SETTING, days)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'download_log.retention.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { days, previous },
    request,
  })
  return { days, previous }
}
