/**
 * What the server answered for a conversation's `temporary` when this page
 * created it (ADR-0180). The create is sent with the flag the chat had at that
 * moment; a person who switches while it is in flight is settled against this
 * record once the row exists (`temporary-conversation.ts`). An id that already
 * existed answers its row as it stands, so the record is the server's word
 * either way.
 *
 * Its own module, without the store: the store's create path writes it and the
 * switch reads it, and neither may import the other.
 */

const created = new Map<string, boolean>()

export function recordCreatedTemporary(conversationId: string, temporary: boolean): void {
  created.set(conversationId, temporary)
}

/** `undefined` for a conversation this page did not create. */
export function createdTemporary(conversationId: string): boolean | undefined {
  return created.get(conversationId)
}

/** Specs only. */
export function resetCreatedTemporary(): void {
  created.clear()
}
