import { z } from 'zod'

import { runViewSchema, type RunView } from './run-ledger-types'
import type { PlanDocument, PlanDocuments } from './plan-documents'

export type RunViewFetch = (input: string, init?: RequestInit) => Promise<Response>

export class RunViewError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null
  ) {
    super(message)
    this.name = 'RunViewError'
  }
}

const apiRefusalSchema = z.object({ error: z.string().min(1), code: z.string().min(1) })

async function refusalOf(response: Response): Promise<RunViewError> {
  const fallback = `Run view request failed with ${response.status}`
  const body: unknown = await response.json().catch(() => null)
  const parsed = apiRefusalSchema.safeParse(body)
  return parsed.success
    ? new RunViewError(response.status, parsed.data.error, parsed.data.code)
    : new RunViewError(response.status, fallback)
}

export function runViewPath(projectId: string, runId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`
}

export async function fetchRunView(
  projectId: string,
  runId: string,
  run: RunViewFetch = (input, init) => fetch(input, init)
): Promise<RunView> {
  return requestRunView(run, runViewPath(projectId, runId), 'GET')
}

export async function fetchLiveRunView(
  projectId: string,
  runId: string,
  run: RunViewFetch = (input, init) => fetch(input, init)
): Promise<RunView> {
  return requestRunView(run, `${runViewPath(projectId, runId)}?include=stream`, 'GET')
}

export function runCancelPath(projectId: string, runId: string): string {
  return `${runViewPath(projectId, runId)}/cancel`
}

export function runsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/runs`
}

export const commissionedRunSchema = z
  .object({
    runId: z.string().min(1),
    runMessageId: z.string().nullable(),
    conversationId: z.string(),
    status: z.string(),
  })
  .strict()
export type CommissionedRun = z.infer<typeof commissionedRunSchema>

export async function commissionRun(
  projectId: string,
  input: { conversationId: string; question: string; context?: string; documents?: PlanDocuments },
  run: RunViewFetch = (i, init) => fetch(i, init)
): Promise<CommissionedRun> {
  const response = await run(runsPath(projectId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new RunViewError(response.status, 'The run could not be commissioned')
  return commissionedRunSchema.parse(await response.json())
}

export function runDocumentsPath(projectId: string, runId: string): string {
  return `${runViewPath(projectId, runId)}/documents`
}

export async function addRunDocument(
  projectId: string,
  runId: string,
  document: PlanDocument,
  run: RunViewFetch = (input, init) => fetch(input, init)
): Promise<RunView> {
  const { name, title, shelf } = document
  const response = await run(runDocumentsPath(projectId, runId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name, title, shelf }),
  })
  if (!response.ok) throw await refusalOf(response)
  return runViewSchema.parse(await response.json())
}

export function runWriteNowPath(projectId: string, runId: string): string {
  return `${runViewPath(projectId, runId)}/write-now`
}

export async function writeNowRun(
  projectId: string,
  runId: string,
  run: RunViewFetch = (input, init) => fetch(input, init)
): Promise<RunView> {
  return requestRunView(run, runWriteNowPath(projectId, runId), 'POST')
}

export async function cancelRun(
  projectId: string,
  runId: string,
  run: RunViewFetch = (input, init) => fetch(input, init)
): Promise<RunView> {
  return requestRunView(run, runCancelPath(projectId, runId), 'POST')
}

async function requestRunView(
  run: RunViewFetch,
  path: string,
  method: 'GET' | 'POST'
): Promise<RunView> {
  const response = await run(path, {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new RunViewError(response.status, `Run view request failed with ${response.status}`)
  }
  const payload: unknown = await response.json()
  return runViewSchema.parse(payload)
}
