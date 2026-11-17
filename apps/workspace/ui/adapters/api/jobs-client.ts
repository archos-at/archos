import type { TaskPage, TaskRunPage, TaskRunView, TaskView } from '@/lib/tasks/task-wire'
import { ApiRequestError } from './api-error'

export type Job = TaskView

export type JobRun = TaskRunView

export const TASK_LIST_PAGE = 200

export interface CreateJobInput {
  name: string
  prompt: string
  skillName?: string | null
  dataSources?: string[] | null
  enabled?: boolean
  scheduleCron?: string | null
  scheduleTimezone?: string
  dueAt?: string | null
}

export type UpdateJobInput = Partial<CreateJobInput>

export interface ListJobRunsParams {
  limit?: number
}

export interface ListProjectRunsParams {
  limit: number
}

export class JobApiError extends ApiRequestError {
  readonly code: string | null
  readonly serverMessage: string | null

  constructor(message: string, status: number, code: string | null, serverMessage: string | null) {
    super(message, status)
    this.name = 'JobApiError'
    this.code = code
    this.serverMessage = serverMessage
  }
}

const jobsBase = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/tasks`

const runsBase = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/runs`

const parseErrorEnvelope = async (
  response: Response,
): Promise<{ message: string | null; code: string | null }> => {
  const text = await response.text().catch(() => '')
  if (!text) return { message: null, code: null }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; code?: unknown }
    const message = typeof parsed.error === 'string' ? parsed.error : null
    const code = typeof parsed.code === 'string' ? parsed.code : null
    return { message, code: code ?? null }
  } catch {
    return { message: text, code: null }
  }
}

const throwJobApiError = async (response: Response, context: string): Promise<never> => {
  const { message, code } = await parseErrorEnvelope(response)
  throw new JobApiError(
    `${context}: ${response.status}${message ? ` - ${message}` : ''}`,
    response.status,
    code,
    message,
  )
}

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

export const listJobs = async (projectId: string): Promise<Job[]> => {
  const response = await fetch(`${jobsBase(projectId)}?limit=${TASK_LIST_PAGE}`, { headers: jsonHeaders })
  if (!response.ok) await throwJobApiError(response, 'Failed to list tasks')
  const data = (await response.json()) as Partial<TaskPage>
  return data.tasks ?? []
}

export const getJob = async (projectId: string, jobId: string): Promise<Job> => {
  const response = await fetch(`${jobsBase(projectId)}/${encodeURIComponent(jobId)}`, {
    headers: jsonHeaders,
  })
  if (!response.ok) await throwJobApiError(response, 'Failed to load job')
  return (await response.json()) as Job
}

export const createJob = async (projectId: string, input: CreateJobInput): Promise<Job> => {
  const response = await fetch(jobsBase(projectId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwJobApiError(response, 'Failed to create task')
  const parsed = (await response.json()) as { task: Job }
  return parsed.task
}

export const updateJob = async (
  projectId: string,
  jobId: string,
  input: UpdateJobInput,
): Promise<Job> => {
  const response = await fetch(`${jobsBase(projectId)}/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwJobApiError(response, 'Failed to update job')
  return (await response.json()) as Job
}

export const deleteJob = async (projectId: string, jobId: string): Promise<void> => {
  const response = await fetch(`${jobsBase(projectId)}/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: jsonHeaders,
  })
  if (!response.ok) await throwJobApiError(response, 'Failed to delete job')
}

export const runJob = async (projectId: string, jobId: string): Promise<JobRun> => {
  const response = await fetch(`${jobsBase(projectId)}/${encodeURIComponent(jobId)}/run`, {
    method: 'POST',
    headers: jsonHeaders,
  })
  if (!response.ok) await throwJobApiError(response, 'Failed to run task')
  const parsed = (await response.json()) as { run: JobRun }
  return parsed.run
}

export const listJobRuns = async (
  projectId: string,
  jobId: string,
  params: ListJobRunsParams = {},
): Promise<JobRun[]> => {
  const search = new URLSearchParams({ taskId: jobId })
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  const response = await fetch(`${runsBase(projectId)}?${search.toString()}`, { headers: jsonHeaders })
  if (!response.ok) await throwJobApiError(response, 'Failed to list task runs')
  const data = (await response.json()) as Partial<TaskRunPage>
  return data.runs ?? []
}

export const listProjectRuns = async (
  projectId: string,
  params: ListProjectRunsParams,
): Promise<JobRun[]> => {
  const response = await fetch(`${runsBase(projectId)}?limit=${params.limit}`)
  if (!response.ok) await throwJobApiError(response, 'Failed to list project runs')
  const data = (await response.json()) as Partial<TaskRunPage>
  return data.runs ?? []
}
