import { toast } from 'sonner'
import { useChatStore } from '@/features/chat/store'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { FileItem } from '../components/project-file-workspace'
import { useFilePreviewStore, type FilePreviewMode } from '../stores/file-preview-store'

let boundSubjectId: string | null = null
let unsubscribe: (() => void) | null = null

const clearBoundSubject = (): void => {
  if (!boundSubjectId) return
  const subject = useChatStore.getState().composerSubject
  if (subject?.resourceId === boundSubjectId) {
    useChatStore.getState().setComposerSubject(null)
  }
  boundSubjectId = null
}

const ensureCloseClearsSubject = (): void => {
  if (unsubscribe) return
  unsubscribe = useFilePreviewStore.subscribe((state, previous) => {
    if (!boundSubjectId) return
    const closed = previous.file != null && state.file == null
    if (closed) clearBoundSubject()
  })
}

export interface OpenFilePeekOptions {
  file: FileItem
  source: 'project' | 'office' | 'session' | null
  projectId?: string | null
  projectName?: string | null
  canCollaborate?: boolean
  bindComposerSubject?: boolean
  presentation?: FilePreviewMode
}

export function openFilePeek(options: OpenFilePeekOptions): void {
  const bind = options.bindComposerSubject !== false
  ensureCloseClearsSubject()

  useFilePreviewStore.getState().open(options.file, options.presentation ?? 'peek', {
    projectId: options.source === 'project' ? (options.projectId ?? undefined) : undefined,
    projectName: options.projectName ?? undefined,
    scope: options.source === 'office' ? 'officeShelf' : 'files',
    canManage: false,
    canCollaborate: options.canCollaborate,
  })

  if (!bind) return

  boundSubjectId = options.file.id
  const shelf =
    options.source === 'office' ? 'office_shelf' : options.source === 'session' ? 'session' : options.source === 'project' ? 'project' : undefined
  useChatStore.getState().setComposerSubject({
    resourceType: 'document',
    resourceId: options.file.id,
    title: documentDisplayName(options.file),
    filename: options.file.filename,
    ...(shelf ? { shelf } : {}),
  })
}

export function dropFileSubject(labels: { cleared: string; undo: string }): void {
  const preview = useFilePreviewStore.getState()
  const previous = {
    file: preview.file,
    mode: preview.mode,
    context: preview.context,
    subject: useChatStore.getState().composerSubject,
  }

  useChatStore.getState().setComposerSubject(null)
  preview.close()

  toast(labels.cleared, {
    action: {
      label: labels.undo,
      onClick: () => {
        if (previous.file) {
          useFilePreviewStore.getState().open(previous.file, previous.mode, previous.context)
        }
        if (previous.subject) useChatStore.getState().setComposerSubject(previous.subject)
      },
    },
  })
}

export const resetFilePeekBinding = (): void => {
  boundSubjectId = null
  unsubscribe?.()
  unsubscribe = null
}
