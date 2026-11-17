import type { AnswerKind } from '@/lib/conversations/message-answer-meta'

export const FILE_NOTE_MIN_CHARS = 900

const FILEABLE_KINDS: ReadonlySet<AnswerKind> = new Set<AnswerKind>(['walkthrough', 'ruling'])

export interface FileNoteContext {
  kind?: AnswerKind
  projectId?: string | null
  body?: string | null
}

export function offersFileNote({ kind, projectId, body }: FileNoteContext): boolean {
  if (!kind || !FILEABLE_KINDS.has(kind)) return false
  if (!projectId) return false
  return (body?.trim().length ?? 0) > FILE_NOTE_MIN_CHARS
}
