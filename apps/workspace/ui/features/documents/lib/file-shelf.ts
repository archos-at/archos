import type { DocumentScope } from '../components/document-actions'
import type { FileItem } from '../file-types'
import type { UploadFilesOptions } from '../hooks/use-file-upload'
import type { DocumentNameMatch, RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import type { DocumentLifecyclePermission } from '@/lib/documents/lifecycle-types'
import type { TrackedFile } from '../types'

export interface ShelfUploadApi {
  uploadFiles: (files: File[], options?: UploadFilesOptions) => Promise<number>
  isUploading: boolean
  trackedFiles: TrackedFile[]
  error: string | null
  clearError: () => void
  retryFile: (fileId: string) => Promise<void>
  cancelFile: (fileId: string) => void
  cancelUpload: () => void
  dismissFiles: (fileIds: string[]) => void
}

export interface ShelfUploadInput {
  collectionName: string | undefined
  folderId: string | undefined
  onComplete: () => void
}

export interface ShelfEndpoints {
  list: string
  listParams?: Record<string, string>
  folders: string
  search: string
  searchBody?: Record<string, unknown>
}

export interface ShelfFolderAccess {
  projectId: string
  canManage: boolean
  initialRootAccess: FolderAccessLevel
}

export type FolderAccessLevel = 'read' | 'write'

export interface FileShelf {
  source: 'project' | 'office'
  documentScope: DocumentScope
  endpoints: ShelfEndpoints
  projectId: string | null
  collectionName?: string
  canManage: boolean
  folderAccess?: ShelfFolderAccess
  bin?: { href: string }
  openPoints?: { href: string }
  inboundMail?: { href: string; waiting: number | null; more: boolean; openAddress: () => void }
  canCollaborate: boolean
  currentUserId?: string
  askAbout?: (file: FileItem) => void
  useUpload: (input: ShelfUploadInput) => ShelfUploadApi
  probeNames: (names: readonly string[]) => Promise<DocumentNameMatch[]>
  probeRevisions: (names: readonly string[], landsIn: ReadonlyMap<string, string | null>) => Promise<RevisionCandidateMatch[]>
  handoverKey?: string
  preview: { kind: 'dialog' } | { kind: 'store'; projectName: string }
  messages: {
    dropToUpload: string
    ingestionComplete: (name: string) => string
  }
  showModels: boolean
  lifecyclePermissions?: readonly DocumentLifecyclePermission[]
}

const SHELF_SEARCH_BODY = { kinds: ['document'], facets: false } as const

export function projectSearchScope(projectId: string): Pick<ShelfEndpoints, 'search' | 'searchBody'> {
  return { search: `/api/search?projectId=${encodeURIComponent(projectId)}`, searchBody: SHELF_SEARCH_BODY }
}

export const OFFICE_SHELF_SEARCH_SCOPE: Pick<ShelfEndpoints, 'search' | 'searchBody'> = {
  search: '/api/search?scope=office_shelf',
  searchBody: SHELF_SEARCH_BODY,
}

export function projectEndpoints(projectId: string): ShelfEndpoints {
  return {
    list: '/api/documents',
    listParams: { projectId },
    folders: `/api/projects/${projectId}/folders`,
    ...projectSearchScope(projectId),
  }
}

export const OFFICE_SHELF_ENDPOINTS: ShelfEndpoints = {
  list: '/api/documents',
  listParams: { scope: 'office_shelf' },
  folders: '/api/office-shelf/folders',
  ...OFFICE_SHELF_SEARCH_SCOPE,
}
