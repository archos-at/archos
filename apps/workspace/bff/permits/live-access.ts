import 'server-only'
import {
  folderTree,
  loadCustomFolderTree,
  readRestrictingFoldersOnPath,
  type AccessFolder,
  type FolderTree,
} from '@/lib/authz/folder-access'
import { canonicalRestriction } from '@/lib/projects/memory-service'

export interface LiveFolderAccess {
  visibleFolderIds: string[] | null
  restrictionOf(folderId: string | null): string[] | null
}

const OPEN: LiveFolderAccess = { visibleFolderIds: null, restrictionOf: () => null }

function deletedOnPath(tree: FolderTree, folderId: string): boolean {
  const seen = new Set<string>()
  for (let current = tree.get(folderId); current && !seen.has(current.id); ) {
    if (current.deleted) return true
    seen.add(current.id)
    current = current.parentId ? tree.get(current.parentId) : undefined
  }
  return false
}

export function liveFolderAccessOf(folders: readonly AccessFolder[] | null, readableFolderIds: readonly string[]): LiveFolderAccess {
  if (!folders) return OPEN
  const tree = folderTree(folders)
  const readable = new Set(readableFolderIds.map((id) => id.toLowerCase()))
  const visibleFolderIds = folders
    .filter((folder) => !deletedOnPath(tree, folder.id))
    .filter((folder) => readRestrictingFoldersOnPath(tree, folder.id).every((id) => readable.has(id.toLowerCase())))
    .map((folder) => folder.id)
  return {
    visibleFolderIds,
    restrictionOf: (folderId) => (folderId ? canonicalRestriction(readRestrictingFoldersOnPath(tree, folderId)) : null),
  }
}

export async function liveFolderAccess(
  organizationId: string,
  projectId: string,
  readableFolderIds: readonly string[]
): Promise<LiveFolderAccess> {
  return liveFolderAccessOf(await loadCustomFolderTree(organizationId, projectId), readableFolderIds)
}
