export const NAME_TAKEN_REASON = 'name_taken'

export const NAME_TAKEN_DETAILS = { reason: NAME_TAKEN_REASON } as const

export function nameTakenMessage(filename: string): string {
  return `A document named "${filename}" already exists in this project. Rename the file to upload it.`
}

export function isNameTakenBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const details = (body as { details?: unknown }).details
  return !!details && typeof details === 'object' && (details as { reason?: unknown }).reason === NAME_TAKEN_REASON
}
