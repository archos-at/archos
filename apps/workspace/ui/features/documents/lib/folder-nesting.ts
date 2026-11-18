import type { FolderNavigation } from './file-browser-contract'

export function folderDepthOf(folderNav: FolderNavigation | undefined, currentFolderId: string | null): number {
  if (!folderNav || currentFolderId === null) return 0
  let depth = 0
  let cur: string | null = currentFolderId
  const byId = new Map(folderNav.folders.map((f) => [f.id, f]))
  while (cur) {
    depth += 1
    cur = byId.get(cur)?.parentId ?? null
    if (depth > folderNav.folders.length) break
  }
  return depth
}

export function canAcceptFolderDrop(
  folderNav: FolderNavigation | undefined,
  draggedId: string,
  targetId: string | null
): boolean {
  if (draggedId === targetId) return false
  const all = folderNav?.folders ?? []
  const dragged = all.find((folder) => folder.id === draggedId)
  if (!dragged) return false
  if ((dragged.parentId ?? null) === targetId) return false
  if (targetId === null) return true
  const byId = new Map(all.map((folder) => [folder.id, folder]))
  let cursor: string | null = targetId
  for (let step = 0; cursor !== null && step <= all.length; step += 1) {
    if (cursor === draggedId) return false
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return true
}
