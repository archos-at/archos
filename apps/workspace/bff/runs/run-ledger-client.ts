import {
  runLedgerResponseSchema,
  type RunLedgerResponse,
  type RunPhaseEntry,
  type RunResult,
  type RunStatus,
  type RunStep,
} from './run-ledger-types'

export type RunLedgerFetch = (path: string, init?: RequestInit) => Promise<Response>

export class RunLedgerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'RunLedgerError'
  }
}

export interface RunLedgerAppend {
  steps?: readonly RunStep[]
  phases?: readonly RunPhaseEntry[]
  status?: RunStatus
}

export type RunLedgerOutcome = { result: RunResult } | { error: { reason: string } }

export interface RunLedgerClient {
  append(runId: string, patch: RunLedgerAppend): Promise<RunLedgerResponse>
  finish(runId: string, outcome: RunLedgerOutcome): Promise<RunLedgerResponse>
}

async function request(
  run: RunLedgerFetch,
  runId: string,
  body: Record<string, unknown>,
): Promise<RunLedgerResponse> {
  const response = await run(`/api/internal/runs/${encodeURIComponent(runId)}/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = (payload ?? {}) as { error?: string; code?: string; details?: unknown }
    throw new RunLedgerError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
      error.details,
    )
  }
  return runLedgerResponseSchema.parse(payload)
}

export function createRunLedgerClient(run: RunLedgerFetch): RunLedgerClient {
  return {
    append: (runId, patch) =>
      request(run, runId, {
        op: 'append',
        ...(patch.steps ? { steps: [...patch.steps] } : {}),
        ...(patch.phases ? { phases: [...patch.phases] } : {}),
        ...(patch.status ? { status: patch.status } : {}),
      }),

    finish: (runId, outcome) => request(run, runId, { op: 'finish', ...outcome }),
  }
}
