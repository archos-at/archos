import 'server-only'
import { LICENSED_TEXT_KEY, readLicensedText } from './agent-answer-metadata'
import type { CreateMessageInput } from './service'
import { mergeMessageMetadata } from './repository'

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
