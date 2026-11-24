import type { FileItem, FolderItem } from '../file-types'

export interface FolderNavigation {
  folders: FolderItem[]
  currentFolderId: string | null
  onNavigate: (id: string | null) => void
  onCreateFolder: (name: string, parentId?: string) => Promise<boolean>
  onRenameFolder: (folderId: string, name: string) => Promise<boolean>
  onDeleteFolder: (folderId: string) => Promise<boolean>
  readOnly?: boolean
  onEditFolderAccess?: (folderId: string) => void
  onDescribeFolder?: (folderId: string) => void
  rootAccess?: 'read' | 'write'
}

export function mayWriteAt(folderNav: FolderNavigation | undefined, folderId: string | null): boolean {
  if (!folderNav) return true
  if (folderId === null) return folderNav.rootAccess !== 'read'
  return folderNav.folders.find((folder) => folder.id === folderId)?.access !== 'read'
}

export interface FileBrowserSelection {
  active: boolean
  selectedIds: ReadonlySet<string>
  onToggle: (documentId: string) => void
  onStart?: () => void
}

export interface BriefSlice {
  files: readonly FileItem[]
  label: string
  onClear: () => void
  loading?: boolean
}
