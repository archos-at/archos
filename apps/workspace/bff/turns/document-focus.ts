/**
 * What a turn about one stored document names as its focus, for every turn
 * the BFF starts itself (a wake, a document check).
 *
 * `focus_file_name` is the stored filename, never the display name. Retrieval
 * matches it exactly against the filename every chunk carries, and a rename
 * changes only the display name (`document-edits.ts`), so a display name
 * focuses on nothing: the filter falls open and the turn reads the whole
 * project instead of the document it is about. The composer sends the same
 * filename (`docs/api/websocket-protocol.md`, „Turn retrieval intent“).
 */

import type { ClientMessage } from '@/adapters/api/wire-v2'

type UserMessage = Extract<ClientMessage, { message_id: string; text: string }>

export type DocumentFocus = Required<Pick<UserMessage, 'focus_file_name' | 'focus_document_id'>>

export function documentFocus(document: { id: string; filename: string }): DocumentFocus {
  return { focus_file_name: document.filename, focus_document_id: document.id }
}
