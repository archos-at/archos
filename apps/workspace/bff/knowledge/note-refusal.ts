/**
 * The vocabulary of a refused memory note, shared by the guard that refuses it
 * (`note-content-guard.ts`) and the panels that say why in the person's
 * language. A leaf: it imports nothing, so a browser bundle can read it.
 *
 * The refusal is a 400 whose `details` are `{ reason: 'note_refused', kind }`.
 */

/** The kinds a refusal names, in the order they are looked for. The first five are the content screen's detectors. */
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

/** `details.reason` of the refusal, beside `details.kind`. */
export const NOTE_REFUSED_REASON = 'note_refused'

const KINDS: ReadonlySet<string> = new Set<string>([...SECRET_KINDS, ...CONTACT_KINDS])

/** The kind a refusal's `details` name, or null for any other answer and a kind this build does not know. */
export function noteRefusalKind(details: unknown): NoteRefusalKind | null {
  if (typeof details !== 'object' || details === null) return null
  const { reason, kind } = details as { reason?: unknown; kind?: unknown }
  if (reason !== NOTE_REFUSED_REASON || typeof kind !== 'string' || !KINDS.has(kind)) return null
  return kind as NoteRefusalKind
}
