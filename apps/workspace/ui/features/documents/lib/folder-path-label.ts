export interface PathFolder {
  id: string
  name: string
  parentId: string | null
}

function folderPathParts(folder: PathFolder, byId: Map<string, PathFolder>): string[] {
  const parts = [folder.name]
  let parentId = folder.parentId
  for (let hops = 0; parentId && hops < byId.size; hops += 1) {
    const parent = byId.get(parentId)
    if (!parent) break
    parts.unshift(parent.name)
    parentId = parent.parentId
  }
  return parts
}

export function folderPathLabel(folder: PathFolder, byId: Map<string, PathFolder>): string {
  return folderPathParts(folder, byId).join(' / ')
}

export function documentPathIn(folders: readonly PathFolder[], folderId: string | null | undefined, name: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const folder = folderId ? byId.get(folderId) : undefined
  return folder ? [...folderPathParts(folder, byId), name].join('/') : name
}

export interface FolderDestination {
  folder: PathFolder
  label: string
}

export function sortedFolderDestinations(folders: readonly PathFolder[]): FolderDestination[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  return folders
    .map((folder) => ({ folder, label: folderPathLabel(folder, byId) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
