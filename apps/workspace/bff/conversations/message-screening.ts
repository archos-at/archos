import 'server-only'
import { maskAnswerText, maskChatText } from '@/lib/upload-screening/service'
import { sanitizePromptState, type StoredPromptState } from './message-prompt'

export async function screenedInputs<
  T extends { role: string; content: string; mentionNote?: string | null; metadata?: Record<string, unknown> },
>(organizationId: string, inputs: T[], options: { wholeText?: boolean } = {}): Promise<T[]> {
  const mask = async (text: string): Promise<string> => (await maskChatText(organizationId, text)).text
  const maskContent = async (input: T): Promise<string> =>
    input.role === 'user' || options.wholeText
      ? mask(input.content)
      : (await maskAnswerText(organizationId, input.content)).text
  return Promise.all(
    inputs.map(async (input) => ({
      ...input,
      content: await maskContent(input),
      ...(input.mentionNote ? { mentionNote: await mask(input.mentionNote) } : {}),
      ...(input.metadata?.promptState !== undefined
        ? {
            metadata: {
              ...input.metadata,
              promptState: await screenedPromptState(organizationId, input.metadata.promptState),
            },
          }
        : {}),
    }))
  )
}

export async function screenedPromptState(
  organizationId: string,
  raw: unknown
): Promise<StoredPromptState | undefined> {
  const promptState = sanitizePromptState(raw)
  if (!promptState) return undefined
  return { ...promptState, response: (await maskChatText(organizationId, promptState.response)).text }
}
