import { apiConfig } from './config'
import { ApiRequestError } from './api-error'
import type { WireCitationSource } from '@/features/chat/types'
import type { DeepResearchJobStatus } from './deep-research-events'

const getDeepResearchBaseUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '/api/jobs/async' : `${apiConfig.baseUrl}/v1/jobs/async`
}

const getDeepResearchErrorDetails = async (response: Response): Promise<string | null> => {
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

const throwDeepResearchApiError = async (response: Response, context: string): Promise<never> => {
  const details = await getDeepResearchErrorDetails(response)
  throw new ApiRequestError(
    `${context}: ${response.status}${details ? ` - ${details}` : ''}`,
    response.status
  )
}

export const getJobStatus = async (
  jobId: string,
  authToken?: string
): Promise<{
  job_id: string
  status: DeepResearchJobStatus
  error: string | null
  created_at?: string | null
}> => {
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to get job status')
  }

  return response.json()
}

export interface JobReportFiling {
  documentId: string
  filename: string
  alreadyFiled: boolean
}

export interface JobReportResponse {
  job_id: string
  has_report: boolean
  report: string | null
  filed?: JobReportFiling
  filingFailed?: boolean
  filingQueued?: boolean
  sources?: WireCitationSource[]
}

function readReportFiling(body: unknown): JobReportFiling | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const filed = (body as { filed?: unknown }).filed
  if (typeof filed !== 'object' || filed === null) return undefined
  const { documentId, filename, alreadyFiled } = filed as Record<string, unknown>
  if (typeof documentId !== 'string' || !documentId) return undefined
  if (typeof filename !== 'string' || !filename) return undefined
  return { documentId, filename, alreadyFiled: alreadyFiled === true }
}

export const getJobReport = async (
  jobId: string,
  authToken?: string,
  options: { projectId?: string | null } = {}
): Promise<JobReportResponse> => {
  const query = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : ''
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}/report${query}`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to get job report')
  }

  const body = (await response.json()) as JobReportResponse
  const filed = readReportFiling(body)
  return {
    job_id: body.job_id,
    has_report: body.has_report,
    report: body.report,
    ...(filed ? { filed } : {}),
    ...(body.filingFailed === true ? { filingFailed: true as const } : {}),
    ...(body.filingQueued === true ? { filingQueued: true as const } : {}),
    ...(Array.isArray(body.sources) && body.sources.length > 0 ? { sources: body.sources } : {}),
  }
}

export const cancelJob = async (
  jobId: string,
  authToken?: string,
  options: { projectId?: string | null } = {}
): Promise<{ cancelled: boolean }> => {
  const query = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : ''
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}/cancel${query}`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to cancel job')
  }

  return response.json()
}

export interface JobStateResponse {
  job_id: string
  has_state: boolean
  state: Record<string, unknown> | null
  artifacts: {
    tools: Array<{
      name: string
      input?: Record<string, unknown>
      output?: string
      timestamp?: string
    }>
    outputs: Array<{
      type: string
      content: string
      output_category?: string
      cards?: unknown[]
      timestamp?: string
    }>
  } | null
}

export const getJobState = async (
  jobId: string,
  authToken?: string
): Promise<JobStateResponse> => {
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}/state`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to get job state')
  }

  return response.json()
}
