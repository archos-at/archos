import { z } from 'zod'
import type { KnowledgeBaseStatus, KnowledgeFile } from './service'

export const MAX_CORPUS_PAGE = 500

export const corpusQuerySchema = z.object({
  nameContains: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Only files whose name contains this text, ignoring case.'),
  countryId: z
    .union([z.string().regex(/^[A-Z]{2}$/), z.literal('none')])
    .optional()
    .describe('Only the files a release marked with this country (ISO 3166-1 alpha-2), or `none` for the files no release marked.'),
  brief: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional()
    .describe('true leaves out each file’s summary, which is most of the answer’s length.'),
  limit: z.coerce.number().int().min(1).max(MAX_CORPUS_PAGE).optional().describe(`At most this many files (up to ${MAX_CORPUS_PAGE}).`),
  cursor: z
    .string()
    .regex(/^\d{1,6}$/)
    .optional()
    .describe('nextCursor of the previous answer.'),
})
export type CorpusQuery = z.infer<typeof corpusQuerySchema>

export type NarrowedCorpus = Omit<KnowledgeBaseStatus, 'files'> & {
  files: Array<KnowledgeFile | Omit<KnowledgeFile, 'summary'>>
  matched: number
  nextCursor: string | null
}

const matches = (file: KnowledgeFile, query: CorpusQuery): boolean => {
  if (query.nameContains && !file.fileName.toLowerCase().includes(query.nameContains.toLowerCase())) return false
  if (query.countryId === 'none') return file.countryId === null
  if (query.countryId) return file.countryId === query.countryId
  return true
}

export function narrowCorpus(status: KnowledgeBaseStatus, query: CorpusQuery): NarrowedCorpus {
  const matching = status.files.filter((file) => matches(file, query))
  const offset = query.cursor === undefined ? 0 : Number(query.cursor)
  const end = query.limit === undefined ? matching.length : offset + query.limit
  const page = matching.slice(offset, end)
  return {
    ...status,
    files: query.brief ? page.map(({ summary: _summary, ...file }) => file) : page,
    matched: matching.length,
    nextCursor: end < matching.length ? String(end) : null,
  }
}
