export interface RevisionFacts {
  documentNumber?: string
  revision?: string
  revisionDate?: string
  scale?: string
  title?: string
  page?: number
}

const MAX_TEXT_LENGTH = 80
const MAX_PAGE = 2000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const boundedText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, MAX_TEXT_LENGTH)
  return text.length > 0 ? text : undefined
}

const usablePage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PAGE

export function parseRevisionFacts(raw: unknown): RevisionFacts | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>

  const facts: RevisionFacts = {}
  const documentNumber = boundedText(fields.document_number)
  if (documentNumber) facts.documentNumber = documentNumber
  const revision = boundedText(fields.revision)
  if (revision) facts.revision = revision
  if (typeof fields.revision_date === 'string' && ISO_DATE.test(fields.revision_date)) {
    facts.revisionDate = fields.revision_date
  }
  const scale = boundedText(fields.scale)
  if (scale) facts.scale = scale
  const title = boundedText(fields.title)
  if (title) facts.title = title
  if (usablePage(fields.page)) facts.page = fields.page

  return Object.keys(facts).length > 0 ? facts : null
}
