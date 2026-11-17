import type { ClientMessage } from '@/adapters/api/wire-v2'

type UserMessage = Extract<ClientMessage, { message_id: string; text: string }>

export type DocumentFocus = Required<Pick<UserMessage, 'focus_file_name' | 'focus_document_id'>>

export function documentFocus(document: { id: string; filename: string }): DocumentFocus {
  return { focus_file_name: document.filename, focus_document_id: document.id }
}
