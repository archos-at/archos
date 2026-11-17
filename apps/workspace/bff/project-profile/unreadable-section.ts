import 'server-only'
import { getRestrictedFolderIds } from '@/lib/authz/folder-access'
import { findFolderPathsInProject, listUnreadableProjectDocuments } from '@/lib/documents/repository'

export const MAX_UNREADABLE_LINES = 20

export interface UnreadableDocument {
  filename: string
  displayName: string | null
  folderPath: string | null
}

export function buildUnreadableDocumentsSection(rows: readonly UnreadableDocument[], more = false): string {
  if (rows.length === 0) return ''
  const lines = rows.slice(0, MAX_UNREADABLE_LINES).map((row) => {
    const name = row.displayName?.trim() ? `${row.displayName.trim()} (${row.filename})` : row.filename
    return `- ${name}${row.folderPath ? ` (Ordner: ${row.folderPath})` : ''}`
  })
  if (more || rows.length > MAX_UNREADABLE_LINES) lines.push('- (weitere nicht lesbare Dateien nicht aufgeführt)')
  return ['documents_unreadable:', ...lines].join('\n')
}

export async function loadUnreadableDocumentsSection(
  projectId: string,
  organizationId: string | null | undefined
): Promise<string> {
  if (!organizationId) return ''
  try {
    const hidden = await getRestrictedFolderIds(organizationId, projectId)
    const rows = await listUnreadableProjectDocuments(projectId, organizationId, hidden, MAX_UNREADABLE_LINES + 1)
    const folderIds = [...new Set(rows.map((row) => row.folderId).filter((id): id is string => id !== null))]
    const paths = await findFolderPathsInProject(folderIds, projectId, organizationId)
    return buildUnreadableDocumentsSection(
      rows.slice(0, MAX_UNREADABLE_LINES).map((row) => ({
        filename: row.filename,
        displayName: row.displayName,
        folderPath: row.folderId ? (paths.get(row.folderId) ?? null) : null,
      })),
      rows.length > MAX_UNREADABLE_LINES
    )
  } catch {
    return ''
  }
}
