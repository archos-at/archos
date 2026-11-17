import type { KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import type { PlanDocument, PlanDocuments } from '@/lib/runs/plan-documents'

function serviceHeaders(toError: (message: string, status: number) => Error): Record<string, string> {
  try {
    return internalServiceHeaders(getBackendUrl())
  } catch (error) {
    if (error instanceof InternalServiceUnavailableError) throw toError(error.message, error.status)
    throw error
  }
}

export interface JobSubmitPayload {
  input: string
  skills: string[]
  output: 'chat' | 'deep-research'
  agent_type?: BackgroundAgentType
  job_id?: string
  conversation_id?: string
  run_id?: string
  clarifier_result?: string
  documents?: PlanDocuments
  data_sources: string[] | null
  collection_scope: string[] | null
  project_context: string | null
  project_memory: string | null
  memory_reflection_enabled: boolean
  temporary_conversation?: boolean
  organization_id: string
  user_id: string | null
  project_id: string | null
  owner_email: string | null
  budget_header: string | null
  model_overrides: Record<string, string> | null
  priority?: JobPriority
  knowledge_context: KnowledgeContext
}

export type BackgroundAgentType = 'project_intake'

export type JobPriority = 'interactive' | 'bulk'

export class JobSubmitSkippedError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null
  ) {
    super(message)
    this.name = 'JobSubmitSkippedError'
  }
}

export class JobSubmitError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'JobSubmitError'
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number.parseInt(header.trim(), 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim()
  } catch {
    return ''
  }
}

export async function submitJob(
  payload: JobSubmitPayload,
  extraHeaders: Record<string, string>
): Promise<{ jobId: string; queued: boolean }> {
  const tokenHeaders = serviceHeaders((message, status) => new JobSubmitError(message, status))

  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}/v1/internal/skills/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...extraHeaders,
        ...tokenHeaders,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error'
    throw new JobSubmitError(message, 503)
  }

  if (response.status === 429) {
    throw new JobSubmitSkippedError(
      await readBody(response),
      parseRetryAfter(response.headers.get('retry-after'))
    )
  }
  if (!response.ok) {
    throw new JobSubmitError(await readBody(response), response.status)
  }

  try {
    const json = (await response.json()) as { jobId?: string; job_id?: string; queued?: boolean }
    const jobId = json.jobId ?? json.job_id
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new JobSubmitError('backend returned no jobId', 502)
    }
    return { jobId, queued: json.queued === true }
  } catch (err) {
    if (err instanceof JobSubmitError) throw err
    throw new JobSubmitError('malformed backend response', 502)
  }
}

export class JobCancelError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'JobCancelError'
  }
}

export interface JobControlCaller {
  accessToken: string | null
  contextHeaders: Record<string, string>
}

export async function cancelBackendJob(
  backendJobId: string,
  caller: JobControlCaller
): Promise<void> {
  return postJobControl(backendJobId, 'cancel', caller)
}

export async function writeNowBackendJob(
  backendJobId: string,
  caller: JobControlCaller
): Promise<void> {
  return postJobControl(backendJobId, 'write-now', caller)
}

export async function addDocumentToBackendJob(
  backendJobId: string,
  document: PlanDocument,
  caller: JobControlCaller
): Promise<void> {
  return postJobControl(backendJobId, 'documents', caller, document)
}

async function postJobControl(
  backendJobId: string,
  action: 'cancel' | 'write-now' | 'documents',
  caller: JobControlCaller,
  body?: unknown
): Promise<void> {
  let response: Response
  try {
    response = await fetch(
      `${getBackendUrl()}/v1/jobs/async/job/${encodeURIComponent(backendJobId)}/${action}`,
      {
        method: 'POST',
        headers: {
          ...caller.contextHeaders,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(caller.accessToken ? { Authorization: `Bearer ${caller.accessToken}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error'
    throw new JobCancelError(message, 503)
  }
  if (!response.ok) {
    throw new JobCancelError(await readBody(response), response.status)
  }
}

export interface BackendKillResult {
  found: number
  killed: string[]
  alreadyFinished: number
  failed: { jobId: string; error: string }[]
  truncated: boolean
}

const KILL_TIMEOUT_MS = 120_000

export async function killActiveBackendJobs(): Promise<BackendKillResult> {
  const tokenHeaders = serviceHeaders((message, status) => new JobCancelError(message, status))
  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}/v1/internal/jobs/kill-active`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...tokenHeaders },
      signal: AbortSignal.timeout(KILL_TIMEOUT_MS),
    })
  } catch (err) {
    throw new JobCancelError(err instanceof Error ? err.message : 'network error', 503)
  }
  if (!response.ok) throw new JobCancelError(await readBody(response), response.status)
  const raw = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!Array.isArray(raw.killed)) throw new JobCancelError('malformed backend response', 502)
  const failed = Array.isArray(raw.failed) ? (raw.failed as { job_id?: unknown; error?: unknown }[]) : []
  return {
    found: Number(raw.found ?? 0),
    killed: raw.killed.filter((id): id is string => typeof id === 'string'),
    alreadyFinished: Number(raw.already_finished ?? 0),
    failed: failed.map((f) => ({ jobId: String(f.job_id ?? ''), error: String(f.error ?? '') })),
    truncated: raw.truncated === true,
  }
}

export type BackendJobStatus = 'submitted' | 'running' | 'success' | 'failure' | 'interrupted'

export interface BackendJobOutcome {
  status: BackendJobStatus
  error: string | null
  report: string | null
  cards: unknown[] | null
  message: { content: string; metadata: Record<string, unknown> } | null
}

export class JobProbeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'JobProbeError'
  }
}

const BACKEND_JOB_STATUSES: ReadonlySet<string> = new Set<BackendJobStatus>([
  'submitted',
  'running',
  'success',
  'failure',
  'interrupted',
])

const PROBE_TIMEOUT_MS = 10_000

export async function fetchBackendJobOutcome(
  backendJobId: string,
  organizationId: string
): Promise<BackendJobOutcome | null> {
  const tokenHeaders = serviceHeaders((message, status) => new JobProbeError(message, status))

  const url =
    `${getBackendUrl()}/v1/internal/jobs/${encodeURIComponent(backendJobId)}/outcome` +
    `?organization_id=${encodeURIComponent(organizationId)}`
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...tokenHeaders },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (err) {
    throw new JobProbeError(err instanceof Error ? err.message : 'network error', 503)
  }
  if (response.status === 404) return null
  if (!response.ok) throw new JobProbeError(await readBody(response), response.status)

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new JobProbeError('malformed backend response', 502)
  }
  return parseJobOutcome(body)
}

function parseJobOutcome(body: unknown): BackendJobOutcome {
  const raw = (body ?? {}) as Record<string, unknown>
  if (typeof raw.status !== 'string' || !BACKEND_JOB_STATUSES.has(raw.status)) {
    throw new JobProbeError(`unknown job status ${JSON.stringify(raw.status)}`, 502)
  }
  const message = raw.message as { content?: unknown; metadata?: unknown } | null | undefined
  return {
    status: raw.status as BackendJobStatus,
    error: typeof raw.error === 'string' ? raw.error : null,
    report: typeof raw.report === 'string' && raw.report ? raw.report : null,
    cards: Array.isArray(raw.cards) ? raw.cards : null,
    message:
      message && typeof message.content === 'string'
        ? {
            content: message.content,
            metadata:
              message.metadata && typeof message.metadata === 'object'
                ? (message.metadata as Record<string, unknown>)
                : {},
          }
        : null,
  }
}
