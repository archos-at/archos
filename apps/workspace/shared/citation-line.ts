/**
 * What a citation carries for its line (docs/design/citations.md, design §6.7):
 * which edition a source is, what that edition is at the site, through which
 * instrument and from which day, when it was last checked, which text it is,
 * where a person opens it in public and when it was read.
 *
 * One schema for the three places that hold it: the live wire
 * (`citations/wire.py` `source_entry_to_wire`), the stored message
 * (`messages.metadata.citations`, written by the BFF and by the browser) and the
 * citation in the UI. The agent resolves every field from the knowledge records
 * by the id of the record a passage was read as; nothing here is derived, guessed
 * or worded. Wording the line is the formatter's job, per country's style.
 *
 * Pure and zod, no imports of ours: the BFF and the UI both read it.
 */

import { z } from 'zod'

const day = z.iso.date()
const token = z.string().min(1).max(64)
const name = z.string().min(1).max(300)

/** A public address a person may open: https only, bounded. */
const publicUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  })

const routeSchema = z.object({
  work_id: z.string().min(1).max(200),
  designation: name.optional(),
  edition_label: name.optional(),
  provision: name.optional(),
})

const revisionSchema = z.object({ index: z.string().min(1).max(16).optional(), date: day.optional() })

/** The wire fields, in wire spelling. Each is optional: a field the records do not state is absent. */
export const CITATION_LINE_FIELDS = {
  /** The edition's role at the site (`EDITION_ROLES`), and what qualifies it. */
  role: token,
  role_qualifier: token,
  /** The knowledge records the passage was read as. */
  work_id: z.string().min(1).max(200),
  edition_id: z.string().min(1).max(200),
  /** The work's designation and the edition's label, as their records name them. */
  designation: name,
  edition_label: name,
  /** Who issues the work, as its record names it: the publisher a line of the edition's text names. */
  issuer: name,
  /** The instrument that declares the edition binding here; absent for law in its territory. */
  route: routeSchema,
  /** The first day a binding role holds from, and the day the role was resolved for. */
  role_since: day,
  as_of: day,
  /** The platform's newest check of the edition, and how current that leaves it. */
  last_checked_at: day,
  freshness: token,
  role_labels: z.array(token).max(8),
  /** Which text was read: its language (BCP 47) and whether it is the authentic one. */
  language: z.string().min(2).max(35),
  text_status: token,
  /** Where a person opens the source in public. Never a link into a thread. */
  public_url: publicUrl,
  /** The day the turn read a source that was read live. */
  retrieved_at: day,
  /** Which Fassung the text is: a document's index and day, a consolidated law's in-force day. */
  revision: revisionSchema,
} as const

export type CitationLineKey = keyof typeof CITATION_LINE_FIELDS
export const CITATION_LINE_KEYS = Object.keys(CITATION_LINE_FIELDS) as CitationLineKey[]

export type CitationLineWire = { [Key in CitationLineKey]?: z.infer<(typeof CITATION_LINE_FIELDS)[Key]> }

/**
 * The line fields of a wire or stored source, each kept only when it is what
 * its schema allows. A malformed field is dropped on its own, never the source:
 * a citation with no status line is honest, a citation lost to one bad date is not.
 */
export function citationLineOf(input: unknown): CitationLineWire {
  if (typeof input !== 'object' || input === null) return {}
  const source = input as Record<string, unknown>
  const line: Record<string, unknown> = {}
  for (const key of CITATION_LINE_KEYS) {
    const parsed = CITATION_LINE_FIELDS[key].safeParse(source[key])
    if (parsed.success) line[key] = parsed.data
  }
  return line as CitationLineWire
}

/** Whether a source carries anything for its line. */
export const hasCitationLine = (line: CitationLineWire | undefined): line is CitationLineWire =>
  line !== undefined && Object.keys(line).length > 0
