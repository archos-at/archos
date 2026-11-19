import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { officeShelfHiddenFolderIds } from '@/lib/office-shelf/folder-service'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { OFFICE_SHELF, projectShelf, type DocumentShelf } from './shelf'
import { listShelfFailedDocuments, summarizeShelfFolders, type ShelfReadFilters } from './repository'
import type { ShelfSummary } from './shelf-summary-types'

export interface ShelfSummaryOptions {
  authoredBy?: DocumentAuthor
  includeArchived?: boolean
}

async function readShelfSummary(
  shelf: DocumentShelf,
  organizationId: string,
  filters: ShelfReadFilters,
): Promise<ShelfSummary> {
  const [folders, failed] = await Promise.all([
    summarizeShelfFolders(shelf, organizationId, filters),
    listShelfFailedDocuments(shelf, organizationId, filters),
  ])
  return { folders, ...failed }
}

export async function summarizeProjectDocuments(
  session: AuthorizedSession,
  projectId: string,
  options: ShelfSummaryOptions = {},
): Promise<ShelfSummary> {
  await requireProjectAccess(session, projectId, 'project:view')
  const reader = await shelfReaderFor(session, { scope: 'project', projectId })
  return readShelfSummary(projectShelf(projectId), session.organizationId, {
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader,
    authoredBy: options.authoredBy,
    includeArchived: options.includeArchived,
  })
}

export async function summarizeOfficeShelfDocuments(
  session: AuthorizedSession,
  options: ShelfSummaryOptions = {},
): Promise<ShelfSummary> {
  const [reader, hiddenFolderIds] = await Promise.all([
    shelfReaderFor(session, { scope: 'office_shelf', projectId: null }),
    officeShelfHiddenFolderIds(session),
  ])
  return readShelfSummary(OFFICE_SHELF, session.organizationId, {
    hiddenFolderIds,
    reader,
    authoredBy: options.authoredBy,
    includeArchived: options.includeArchived,
  })
}
