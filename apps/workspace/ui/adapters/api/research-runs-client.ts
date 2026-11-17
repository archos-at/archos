import { ApiRequestError } from './api-error'

export type ResearchRunStatus = 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ResearchRun {
  job_id: string
  status: string
  created_at: string
  conversation_id: string | null
  project_collection: string | null
}

export interface ListResearchRunsResponse {
  jobs: ResearchRun[]
  total: number
}

export interface ListResearchRunsParams {
  projectId?: string
  conversationId?: string
  status?: string
  limit?: number
  offset?: number
}

const RESEARCH_RUNS_URL = '/api/jobs/async/jobs'

const getResearchRunsErrorDetails = async (response: Response): Promise<string | null> => {
  const responseText = await response.text().catch(() => '')
  if (!responseText) return null

  try {
    const parsed = JSON.parse(responseText) as {
      error?: {
        code?: unknown
        message?: unknown
      }
    }
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    return [code, message].filter(Boolean).join(': ') || responseText
  } catch {
    return responseText
  }
}

const throwResearchRunsApiError = async (response: Response, context: string): Promise<never> => {
  const details = await getResearchRunsErrorDetails(response)
  throw new ApiRequestError(
    `${context}: ${response.status}${details ? ` - ${details}` : ''}`,
    response.status
  )
}

const isResearchRun = (value: unknown): value is ResearchRun => {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Record<string, unknown>
  return (
    typeof run.job_id === 'string' &&
    typeof run.status === 'string' &&
    typeof run.created_at === 'string' &&
    (run.conversation_id === null || typeof run.conversation_id === 'string' || run.conversation_id === undefined) &&
    (run.project_collection === null || typeof run.project_collection === 'string' || run.project_collection === undefined)
  )
}

const normalizeListResearchRunsResponse = (data: unknown): ListResearchRunsResponse => {
  const raw = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.filter(isResearchRun).map((run) => ({
        ...run,
        conversation_id: run.conversation_id ?? null,
        project_collection: run.project_collection ?? null,
      }))
    : []
  const total = typeof raw.total === 'number' ? raw.total : jobs.length
  return { jobs, total }
}

export const listResearchRuns = async (
  params: ListResearchRunsParams = {},
  authToken?: string
): Promise<ListResearchRunsResponse> => {
  const { projectId, conversationId, status, limit, offset } = params

  const searchParams = new URLSearchParams()
  if (projectId) searchParams.set('projectId', projectId)
  if (conversationId) searchParams.set('conversation_id', conversationId)
  if (status) searchParams.set('status', status)
  if (limit !== undefined) searchParams.set('limit', String(limit))
  if (offset !== undefined) searchParams.set('offset', String(offset))

  const query = searchParams.toString()
  const url = `${RESEARCH_RUNS_URL}${query ? `?${query}` : ''}`

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwResearchRunsApiError(response, 'Failed to list research runs')
  }

  return normalizeListResearchRunsResponse(await response.json())
}
