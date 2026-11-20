export const UNKNOWN_EDITION = 'unbekannt'

export const editionKey = (label: string | null): string | null => {
  const key = label?.trim().toLowerCase() ?? ''
  return key && key !== UNKNOWN_EDITION ? key : null
}

export function isHeldEdition(label: string | null, held: readonly (string | null)[]): boolean {
  const key = editionKey(label)
  return key !== null && held.some((other) => editionKey(other) === key)
}
