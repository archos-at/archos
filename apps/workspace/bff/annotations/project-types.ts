import { z } from 'zod'
import { ANNOTATION_EXPORT_FORMATS, type AnnotationExportFormat } from './export-request'
import { annotationViewSchema } from './types'

export const PROJECT_MARK_STATUSES = ['open', 'proposed', 'all-live'] as const
export type ProjectMarkStatus = (typeof PROJECT_MARK_STATUSES)[number]

export const PROJECT_MARK_DUE = ['overdue', 'soon'] as const
export type ProjectMarkDue = (typeof PROJECT_MARK_DUE)[number]

export const DUE_SOON_DAYS = 7

export const PROJECT_MARK_ORDERS = ['document', 'due'] as const
export type ProjectMarkOrder = (typeof PROJECT_MARK_ORDERS)[number]

export const PROJECT_MARKS_PAGE_SIZE = 50
export const MAX_PROJECT_MARKS_PAGE = 100

const MAX_ASSIGNEE_ID = 200

export const PROJECT_MARKS_CURSOR_MAX_LENGTH = 1200

export const ASSIGNEE_ME = 'me'

const filterShape = {
  status: z.enum(PROJECT_MARK_STATUSES).default('open'),
  assignee: z.string().trim().min(1).max(MAX_ASSIGNEE_ID).optional(),
  due: z.enum(PROJECT_MARK_DUE).optional(),
  order: z.enum(PROJECT_MARK_ORDERS).default('document'),
}

export const projectMarksQuerySchema = z.object({
  ...filterShape,
  limit: z.coerce.number().int().min(1).max(MAX_PROJECT_MARKS_PAGE).default(PROJECT_MARKS_PAGE_SIZE),
  cursor: z.string().min(1).max(PROJECT_MARKS_CURSOR_MAX_LENGTH).optional(),
})
export type ProjectMarksQuery = z.output<typeof projectMarksQuerySchema>

export type ProjectMarksFilters = Partial<Pick<ProjectMarksQuery, 'status' | 'assignee' | 'due' | 'order'>>

export const projectMarkViewSchema = annotationViewSchema.extend({
  documentName: z.string(),
})
export type ProjectMarkView = z.infer<typeof projectMarkViewSchema>

export const projectMarksResponseSchema = z.object({
  marks: z.array(projectMarkViewSchema),
  nextCursor: z.string().nullable(),
  restricted: z.boolean().optional(),
})
export type ProjectMarksResponse = z.infer<typeof projectMarksResponseSchema>

export const projectProtocolQuerySchema = z.object({
  ...filterShape,
  format: z.enum(ANNOTATION_EXPORT_FORMATS).default('pdf'),
})
export type ProjectProtocolQuery = z.output<typeof projectProtocolQuerySchema>

export const PROJECT_PROTOCOL_MAX_MARKS = 1000

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/annotations`

function filterParams(filters: ProjectMarksFilters): URLSearchParams {
  const query = new URLSearchParams()
  if (filters.status && filters.status !== 'open') query.set('status', filters.status)
  if (filters.assignee) query.set('assignee', filters.assignee)
  if (filters.due) query.set('due', filters.due)
  if (filters.order && filters.order !== 'document') query.set('order', filters.order)
  return query
}

const withQuery = (path: string, query: URLSearchParams) => {
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export function projectMarksHref(
  projectId: string,
  filters: ProjectMarksFilters = {},
  page: { limit?: number; cursor?: string | null } = {}
): string {
  const query = filterParams(filters)
  if (page.limit !== undefined) query.set('limit', String(page.limit))
  if (page.cursor) query.set('cursor', page.cursor)
  return withQuery(projectPath(projectId), query)
}

export function projectProtocolHref(
  projectId: string,
  filters: ProjectMarksFilters,
  format: AnnotationExportFormat
): string {
  const query = filterParams(filters)
  query.set('format', format)
  return withQuery(`${projectPath(projectId)}/export`, query)
}
