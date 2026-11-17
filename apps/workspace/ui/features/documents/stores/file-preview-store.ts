import { create } from 'zustand'
import { useChatStore } from '@/features/chat/store'
import { PHONE_ON_ITS_SIDE_QUERY } from '@/hooks/phone-on-its-side'
import type { DocumentScope } from '../components/document-actions'
import type { FileItem } from '../components/project-file-workspace'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { MarkTally } from '@/lib/annotations/types'
import type { PageRegion } from '@/features/knowledge/lib/page-region'
import type {
  DocumentLifecyclePermission,
  DocumentVersionState,
} from '@/lib/documents/lifecycle-types'

export type FilePreviewMode = 'modal' | 'peek' | 'expanded'

export const FILE_PEEK_WIDTH_MIN = 280
export const FILE_PEEK_WIDTH_MAX = 960
export const FILE_PEEK_WIDTH_DEFAULT = 320

const FILE_PEEK_LANDSCAPE_SHARE = 0.45

export function defaultPeekWidth(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return FILE_PEEK_WIDTH_DEFAULT
  }
  if (!window.matchMedia(PHONE_ON_ITS_SIDE_QUERY).matches) return FILE_PEEK_WIDTH_DEFAULT
  return clampPeekWidth(window.innerWidth * FILE_PEEK_LANDSCAPE_SHARE)
}

export const FILE_PEEK_WIDTH_STORAGE_KEY = 'filePeek.width'

export function clampPeekWidth(width: number): number {
  return Math.min(FILE_PEEK_WIDTH_MAX, Math.max(FILE_PEEK_WIDTH_MIN, Math.round(width)))
}

export function readStoredPeekWidth(): number | null {
  try {
    const stored = window.localStorage.getItem(FILE_PEEK_WIDTH_STORAGE_KEY)
    if (stored === null || stored.trim() === '') return null
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? clampPeekWidth(parsed) : null
  } catch {
    return null
  }
}

function persistPeekWidth(width: number): void {
  try {
    window.localStorage.setItem(FILE_PEEK_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Storage unavailable — the width still holds for this session.
  }
}

export function isFilePeekVisible(state?: {
  file: FileItem | null
  hidden: boolean
  mode: FilePreviewMode
}): boolean {
  const current = state ?? useFilePreviewStore.getState()
  return current.file != null && !current.hidden && (current.mode === 'peek' || current.mode === 'expanded')
}

function clearMatchingComposerSubject(file: FileItem | null): void {
  if (!file) return
  const chat = useChatStore.getState()
  if (chat.composerSubject?.resourceId === file.id) {
    chat.setComposerSubject(null)
  }
}

export interface FilePreviewContext {
  projectId?: string
  projectName?: string
  canManage?: boolean
  scope?: DocumentScope
  canCollaborate?: boolean
  showModels?: boolean
  lifecyclePermissions?: readonly DocumentLifecyclePermission[]
  viewerUserId?: string | null
  onRenamed?: (fileId: string, displayName: string | null) => void
  onDeleted?: (fileId: string) => void
  onReingested?: (fileId: string, status: string) => void
  onTagsUpdated?: (fileId: string, tags: string[], topics?: string[]) => void
  onOpenDocument?: (fileId: string) => void
  onRevisionChanged?: (fileId: string, revision: RevisionLinks | null) => void
  onLifecycleChanged?: (
    fileId: string,
    summary: { versionState: DocumentVersionState; versionCount: number },
  ) => void
  onMarksChanged?: (fileId: string, marks: MarkTally | null) => void
}

export interface ViewerTarget {
  fileId: string
  page: number | null
  passage: string | null
  regions: readonly PageRegion[] | null
  key: string
}

interface FilePreviewState {
  viewerTarget: ViewerTarget | null
  setViewerTarget: (target: ViewerTarget | null) => void
  file: FileItem | null
  mode: FilePreviewMode
  hidden: boolean
  handoff: boolean
  peekWidth: number
  context: FilePreviewContext
  peekDetails: boolean
  setPeekDetails: (open: boolean) => void
  peekFullScreen: (() => void) | null
  setPeekFullScreen: (fullScreen: (() => void) | null) => void
  open: (file: FileItem, mode: FilePreviewMode, context?: FilePreviewContext) => void
  peek: () => void
  expand: () => void
  hide: () => void
  close: () => void
  beginHandoff: () => void
  endHandoff: () => void
  setPeekWidth: (width: number) => void
  restorePeekWidth: () => number | null
  patchFile: (patch: Partial<FileItem>) => void
}

export const useFilePreviewStore = create<FilePreviewState>((set, get) => ({
  viewerTarget: null,
  setViewerTarget: (viewerTarget) => set({ viewerTarget }),
  file: null,
  mode: 'modal',
  hidden: false,
  handoff: false,
  peekWidth: FILE_PEEK_WIDTH_DEFAULT,
  context: {},
  peekDetails: false,
  setPeekDetails: (peekDetails) => set({ peekDetails }),
  peekFullScreen: null,
  setPeekFullScreen: (peekFullScreen) => set({ peekFullScreen }),

  open: (file, mode, context) =>
    set({
      file,
      mode,
      hidden: false,
      viewerTarget: null,
      peekDetails: false,
      context: { ...get().context, ...context },
    }),

  beginHandoff: () => {
    if (get().file) set({ handoff: true })
  },

  endHandoff: () => set({ handoff: false }),

  peek: () => {
    if (!get().file) return
    set({ mode: 'peek', hidden: false })
  },

  expand: () => {
    if (!get().file) return
    set({ mode: 'expanded', hidden: false })
  },

  hide: () => {
    set({ hidden: true, mode: get().mode === 'modal' ? 'modal' : 'peek' })
  },

  close: () => {
    const file = get().file
    set({ file: null, hidden: false, mode: 'modal', handoff: false, viewerTarget: null })
    clearMatchingComposerSubject(file)
  },

  setPeekWidth: (width) => {
    const next = clampPeekWidth(width)
    set({ peekWidth: next })
    persistPeekWidth(next)
  },

  restorePeekWidth: () => {
    const stored = readStoredPeekWidth()
    if (stored === null) {
      const fallback = defaultPeekWidth()
      if (fallback === FILE_PEEK_WIDTH_DEFAULT) return null
      set({ peekWidth: fallback })
      return fallback
    }
    set({ peekWidth: stored })
    return stored
  },

  patchFile: (patch) => {
    const current = get().file
    if (!current) return
    set({ file: { ...current, ...patch } })
  },
}))
