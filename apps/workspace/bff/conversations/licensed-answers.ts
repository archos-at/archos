import 'server-only'
import { LICENSED_TEXT_KEY, readLicensedText } from './agent-answer-metadata'
import type { CreateMessageInput } from './service'
import { mergeMessageMetadata } from './repository'

/**
 * The licensed-text mark onto an answer row the asking tab stored first (ADR-0164, design E44). The internal
 * persist inserts with no-op on conflict, so when the tab won, the server's row and its mark were dropped. The
 * mark is a server fact the browser never writes, so it is merged in, one key, under the row lock
 * (`mergeMessageMetadata`). `inserted` is what the insert actually wrote.
 */
export async function markLicensedAnswers(
  conversationId: string,
  inputs: readonly CreateMessageInput[],
  inserted: readonly { id: string }[]
): Promise<void> {
  const written = new Set(inserted.map((row) => row.id))
  for (const input of inputs) {
    if (written.has(input.id) || !readLicensedText(input.metadata)) continue
    await mergeMessageMetadata(conversationId, input.id, { [LICENSED_TEXT_KEY]: true })
  }
}
