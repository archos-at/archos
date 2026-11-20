import type { FileItem, FolderItem } from '../file-types'
import { subtreeTallies, type KnowledgeTally } from './folder-knowledge'
import { withoutOlderRevisions } from './revision-chain'

export interface FolderRollups {
  counts: ReadonlyMap<string, number>
  tallies: ReadonlyMap<string, KnowledgeTally>
}

export function folderRollupsOf(
  folderStats: FolderRollups | undefined,
  files: readonly FileItem[],
  searchFiles: readonly FileItem[] | undefined,
  folders: readonly FolderItem[] | undefined,
  showOlderRevisions: boolean
): FolderRollups {
  if (folderStats) return folderStats
  const corpus = withoutOlderRevisions(searchFiles ?? files, showOlderRevisions)
  const allFolders = folders ?? []
  const counts = new Map<string, number>()
  const bump = (id: string | null | undefined) => {
    if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const file of corpus) bump(file.folderId)
  for (const folder of allFolders) bump(folder.parentId)
  return { counts, tallies: subtreeTallies(corpus, allFolders) }
}
