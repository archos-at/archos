import { z } from 'zod'

const day = z.iso.date()
const token = z.string().min(1).max(64)
const name = z.string().min(1).max(300)

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

export const CITATION_LINE_FIELDS = {
  role: token,
  role_qualifier: token,
  work_id: z.string().min(1).max(200),
  edition_id: z.string().min(1).max(200),
  designation: name,
  edition_label: name,
  issuer: name,
  route: routeSchema,
  role_since: day,
  as_of: day,
  last_checked_at: day,
  freshness: token,
  role_labels: z.array(token).max(8),
  language: z.string().min(2).max(35),
  text_status: token,
  public_url: publicUrl,
  retrieved_at: day,
  revision: revisionSchema,
} as const

export type CitationLineKey = keyof typeof CITATION_LINE_FIELDS
export const CITATION_LINE_KEYS = Object.keys(CITATION_LINE_FIELDS) as CitationLineKey[]

export type CitationLineWire = { [Key in CitationLineKey]?: z.infer<(typeof CITATION_LINE_FIELDS)[Key]> }

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

export const hasCitationLine = (line: CitationLineWire | undefined): line is CitationLineWire =>
  line !== undefined && Object.keys(line).length > 0
