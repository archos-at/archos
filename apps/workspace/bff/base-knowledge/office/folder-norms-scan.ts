import 'server-only'
import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { findShelfFolder } from '@/lib/documents/shelf-folders'
import { isUnderStandardsRoot } from '@/lib/office-shelf/standards-folder'
import { rolesHoldPermission } from '@/lib/authz/org-role-permissions'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { recipientsHoldingGroup } from '@/lib/inbox/repository'
import { emitInboxItems, openRecipientsOf, refreshOpenInboxGroup, resolveInboxItemsFor } from '@/lib/inbox/service'
import { enqueueJob, enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import type { JobSliceResult } from '@/lib/jobs-queue/types'
import { findOrganizations } from '@/lib/organizations/repository'
import { listOrganizationMembersWithRoles } from '@/lib/organizations/service'
import { withTenant } from '@/lib/db/tenant-context'
import { officeStandardsEnabled } from './access'
import { listUndecidedFolderFiles, type FolderFile } from './folder-norms-repository'
import { recognizeNorm } from './reading'

export const NORMS_FOUND_TYPE = 'office_shelf.norms_found' as const
export const NAMED_NORMS = 12
export const SCAN_PAGE = 500
export const UPLOAD_SCAN_DELAY_MS = 60_000

export const officeNormsScanPayloadSchema = z.object({
  afterId: z.guid().nullable(),
  found: z.number().int().nonnegative(),
  names: z.array(z.string().min(1).max(300)).max(NAMED_NORMS),
  folderId: z.guid().nullable(),
})
export type OfficeNormsScanPayload = z.infer<typeof officeNormsScanPayloadSchema>

export const freshScan = (): OfficeNormsScanPayload => ({ afterId: null, found: 0, names: [], folderId: null })

export function isFolderNorm(file: Pick<FolderFile, 'fileName'>): boolean {
  return recognizeNorm({ fileName: file.fileName }).norm
}

export function normsScanJobId(organizationId: string): string {
  return uuidv5(`grid:office-norms-scan:${organizationId}`, uuidv5.URL)
}

export async function queueNormsScan(organizationId: string, { after }: { after?: number } = {}): Promise<boolean> {
  return enqueueJobIfAbsent({
    kind: 'office_norms_scan',
    organizationId,
    jobId: normsScanJobId(organizationId),
    payload: freshScan(),
    ...(after ? { notBefore: new Date(Date.now() + after) } : {}),
  })
}

export async function scanAfterUpload(
  session: Pick<AuthorizedSession, 'organizationId' | 'featureFlags'>,
  upload: { folderId: string | null; filename: string },
): Promise<void> {
  if (!upload.folderId || !isOfficeStandardsEnabled(session) || !isFolderNorm({ fileName: upload.filename })) return
  try {
    const folder = await findShelfFolder(OFFICE_SHELF, session.organizationId, upload.folderId)
    if (!folder || isUnderStandardsRoot(folder.path)) return
    await queueNormsScan(session.organizationId, { after: UPLOAD_SCAN_DELAY_MS })
  } catch (error) {
    console.warn(`[office-norms] could not queue the scan after an upload to ${upload.folderId}:`, error)
  }
}

export async function rescanNorms(organizationId: string): Promise<void> {
  await enqueueJob({ kind: 'office_norms_scan', organizationId, payload: freshScan() })
}

function withNorms(scan: OfficeNormsScanPayload, files: readonly FolderFile[]): OfficeNormsScanPayload {
  const norms = files.filter(isFolderNorm)
  return {
    afterId: files.at(-1)?.id ?? scan.afterId,
    found: scan.found + norms.length,
    names: [...scan.names, ...norms.map((file) => file.fileName.slice(0, 300))].slice(0, NAMED_NORMS),
    folderId: scan.folderId ?? norms[0]?.folderId ?? null,
  }
}

export async function runNormsScanSlice(
  organizationId: string,
  payload: OfficeNormsScanPayload,
): Promise<JobSliceResult<OfficeNormsScanPayload>> {
  if (!(await officeStandardsEnabled(organizationId))) {
    await announceNormsInFolders(organizationId, freshScan())
    return { done: true, payload }
  }
  const files = await listUndecidedFolderFiles(organizationId, SCREENED_ONLY, { afterId: payload.afterId, limit: SCAN_PAGE })
  const next = withNorms(payload, files)
  if (files.length === SCAN_PAGE) return { done: false, payload: next }
  await announceNormsInFolders(organizationId, next)
  return { done: true, payload: next }
}

export async function officeShelfManagers(organizationId: string): Promise<string[]> {
  const members = await listOrganizationMembersWithRoles(organizationId)
  const verdicts = await Promise.all(
    members
      .filter((member) => member.status === 'active' && member.roleSlug)
      .map(async (member) =>
        (await rolesHoldPermission(organizationId, member.roleSlug ? [member.roleSlug] : [], ORG_PERMISSIONS.officeShelfManage))
          ? member.id
          : null,
      ),
  )
  return verdicts.filter((id): id is string => id !== null)
}

function namesLine(scan: OfficeNormsScanPayload): string {
  const more = scan.found - scan.names.length
  return more > 0 ? `${scan.names.join(', ')} +${more}` : scan.names.join(', ')
}

export async function announceNormsInFolders(organizationId: string, scan: OfficeNormsScanPayload): Promise<void> {
  const groupKey = inboxGroupKey(NORMS_FOUND_TYPE, 'organization', organizationId)
  await bestEffortInbox(`${NORMS_FOUND_TYPE} for ${organizationId}`, organizationId, async () => {
    const managers = scan.found > 0 ? await officeShelfManagers(organizationId) : []
    const open = await openRecipientsOf(organizationId, groupKey)
    const stale = open.filter((userId) => !managers.includes(userId))
    if (stale.length > 0) {
      await resolveInboxItemsFor(stale.map((recipientUserId) => ({ organizationId, recipientUserId, groupKey })))
    }
    if (scan.found === 0) return
    const payload = { excerpt: namesLine(scan) }
    await refreshOpenInboxGroup({
      organizationId,
      groupKey,
      recipientUserIds: open.filter((userId) => managers.includes(userId)),
      anchorId: scan.folderId,
      count: scan.found,
      payload,
    })
    const told = await recipientsHoldingGroup(organizationId, groupKey, managers)
    await emitInboxItems(
      managers
        .filter((userId) => !told.has(userId))
        .map((recipientUserId) => ({
          organizationId,
          recipientUserId,
          type: NORMS_FOUND_TYPE,
          resourceType: 'organization' as const,
          resourceId: organizationId,
          anchorId: scan.folderId,
          actorUserId: null,
          groupKey,
          payload,
          occurrences: scan.found,
        })),
    )
  })
}

export interface NormsSweep {
  organizations: number
  queued: number
}

export async function sweepNormsInFolders(): Promise<NormsSweep> {
  const { organizations } = await findOrganizations()
  const sweep: NormsSweep = { organizations: organizations.length, queued: 0 }
  for (const { workosOrganizationId: organizationId } of organizations) {
    if (!(await officeStandardsEnabled(organizationId))) continue
    if (await withTenant({ organizationId }, () => queueNormsScan(organizationId))) sweep.queued += 1
  }
  return sweep
}
