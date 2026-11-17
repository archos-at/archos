export type ThreadPosition =
  { atEnd: true } | { atEnd: false; messageId: string; offsetTop: number }

const positions = new Map<string, ThreadPosition>()

export const rememberThreadPosition = (conversationId: string, position: ThreadPosition): void => {
  positions.set(conversationId, position)
}

export const readThreadPosition = (conversationId: string): ThreadPosition | undefined =>
  positions.get(conversationId)

export const forgetThreadPosition = (conversationId: string): void => {
  positions.delete(conversationId)
}
