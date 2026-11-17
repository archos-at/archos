import { useChatStore } from '@/features/chat/store'
import type { DraftMention } from '@/lib/mentions/mention-text'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { FileItem } from '../components/project-file-workspace'
import { documentAskQuestion, documentQuestionHref } from './document-question'
import { useFilePreviewStore } from '../stores/file-preview-store'

export { documentAskQuestion }

export function askAboutFile(options: {
  projectId: string
  file: FileItem
  ask?: string
  mentions?: DraftMention[]
  navigate: (href: string) => void
}): void {
  const name = documentDisplayName(options.file)
  const ask = options.ask?.trim() ?? ''
  const preview = useFilePreviewStore.getState()
  if (preview.file?.id === options.file.id) {
    preview.peek()
  } else {
    preview.open(options.file, 'peek', { projectId: options.projectId, scope: 'files' })
  }
  preview.beginHandoff()

  const subject = {
    resourceType: 'document' as const,
    resourceId: options.file.id,
    title: name,
    filename: options.file.filename,
    shelf: 'project' as const,
  }
  const href = documentQuestionHref(
    options.projectId,
    options.file.id,
    ask ? { ask, filename: options.file.filename } : { filename: options.file.filename },
  )
  const chat = useChatStore.getState()
  if (!chat.currentUserId) {
    options.navigate(href)
    return
  }
  const alreadyThisFile = chat.currentConversation?.subjectResourceId === options.file.id
  if (!alreadyThisFile) {
    chat.startNewSessionDraft()
  }
  chat.setComposerPrefill(ask, options.mentions, subject)
  options.navigate(href)
}
