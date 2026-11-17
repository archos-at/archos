export const SECRET_KINDS = [
  'iban',
  'at_svnr',
  'credit_card',
  'de_svnr',
  'de_tax_id',
  'private_key',
  'api_key',
  'credential',
  'identity_number',
] as const
export const CONTACT_KINDS = ['email', 'phone'] as const
export type SecretKind = (typeof SECRET_KINDS)[number]
export type ContactKind = (typeof CONTACT_KINDS)[number]
export type NoteRefusalKind = SecretKind | ContactKind

export const NOTE_REFUSED_REASON = 'note_refused'

const KINDS: ReadonlySet<string> = new Set<string>([...SECRET_KINDS, ...CONTACT_KINDS])

export function noteRefusalKind(details: unknown): NoteRefusalKind | null {
  if (typeof details !== 'object' || details === null) return null
  const { reason, kind } = details as { reason?: unknown; kind?: unknown }
  if (reason !== NOTE_REFUSED_REASON || typeof kind !== 'string' || !KINDS.has(kind)) return null
  return kind as NoteRefusalKind
}
