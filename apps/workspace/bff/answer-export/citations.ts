import { z } from 'zod'
import type { Translator } from '@/i18n/translate'
import { splitReportSources } from '@/features/layout/lib/report-citations'

const storedSourceSchema = z
  .object({
    title: z.string().nullish(),
    url: z.string().nullish(),
    citation_key: z.string().nullish(),
    file_name: z.string().nullish(),
    page: z.number().int().positive().nullish(),
    number: z.number().int().positive().nullish(),
    content: z.string().nullish(),
    lane_label: z.string().nullish(),
    binding_note: z.string().nullish(),
  })
  .passthrough()

const payloadSchema = z.object({
  v: z.literal(1),
  sources: z.array(storedSourceSchema),
})

export interface ReferenceEntry {
  number: number
  label: string
  page?: string
  note?: string
  url?: string
}

const trimmed = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const readSources = (value: unknown): z.infer<typeof storedSourceSchema>[] => {
  const versioned = payloadSchema.safeParse(value)
  if (versioned.success) return versioned.data.sources
  const bare = z.array(storedSourceSchema).safeParse(value)
  return bare.success ? bare.data : []
}

const labelFor = (source: z.infer<typeof storedSourceSchema>, t: Translator): string => {
  const key = trimmed(source.citation_key)
  const title = trimmed(source.title)
  if (title && key && !title.includes(key)) return `${key} — ${title}`
  return key ?? title ?? trimmed(source.file_name) ?? hostOf(source.url) ?? t('untitledSource')
}

const hostOf = (url: unknown): string | undefined => {
  const value = trimmed(url)
  if (!value) return undefined
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

export function referencesFromStored(value: unknown, t: Translator): ReferenceEntry[] {
  const sources = readSources(value)
  if (sources.length === 0) return []

  const numbered = sources.filter((source) => typeof source.number === 'number')
  const listed = numbered.length > 0 ? numbered : sources

  const entries: ReferenceEntry[] = []
  const seen = new Set<number>()
  listed.forEach((source, index) => {
    const number = numbered.length > 0 ? (source.number as number) : index + 1
    if (seen.has(number)) return
    seen.add(number)
    const page = typeof source.page === 'number' ? t('page', { page: source.page }) : undefined
    entries.push({
      number,
      label: labelFor(source, t),
      ...(page ? { page } : {}),
      ...(trimmed(source.binding_note) ?? trimmed(source.lane_label)
        ? { note: trimmed(source.binding_note) ?? trimmed(source.lane_label) }
        : {}),
      ...(trimmed(source.url) ? { url: trimmed(source.url) } : {}),
    })
  })

  return entries.sort((a, b) => a.number - b.number)
}

export interface ProseSplit {
  body: string
  references: ReferenceEntry[]
}

export function splitProse(markdown: string): ProseSplit {
  const split = splitReportSources(markdown)
  return {
    body: split.body,
    references: split.entries.map((entry) => ({ number: entry.number, label: entry.markdown })),
  }
}
