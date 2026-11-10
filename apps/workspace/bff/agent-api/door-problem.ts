/**
 * Every refusal on the door as RFC 9457 problem details (ADR-0170; ADR-0163
 * built the shape for the office's base-knowledge routes). A route answers
 * `{ error, code, details? }` or already a problem; the door hands the agent
 * one shape whatever the route spoke: `type`, `title`, `status`, `detail`,
 * and the extension members `code` (the stable word to branch on) and, when the
 * route gave them, `details` (a validation's per-record problems, for one).
 *
 * In `structuredContent.problem` of the error result, beside the text the model
 * reads, so a scripted client branches on `code` and never parses prose.
 */

import type { CallToolResult } from '@modelcontextprotocol/server'
import type { OperationResult } from './dispatch'

/** Where a problem type is described: one per stable code, so a client can tell them apart. */
export const DOOR_PROBLEM_TYPE_BASE = 'urn:problem-type:'

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

export interface DoorProblem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  details?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The problem a refusal stands for, from whichever shape the route answered. */
export function problemOf(status: number, body: unknown, fallbackCode = `HTTP_${status}`): DoorProblem {
  const record = isRecord(body) ? body : {}
  const detail =
    typeof record.detail === 'string'
      ? record.detail
      : typeof record.error === 'string'
        ? record.error
        : typeof body === 'string' && body.trim() !== ''
          ? body.slice(0, 2000)
          : `The server answered HTTP ${status}.`
  const code = typeof record.code === 'string' ? record.code : fallbackCode
  const type = typeof record.type === 'string' ? record.type : `${DOOR_PROBLEM_TYPE_BASE}${code.toLowerCase()}`
  return {
    type,
    title: TITLES[status] ?? (typeof record.title === 'string' ? record.title : 'Error'),
    status,
    detail,
    code,
    ...(record.details === undefined ? {} : { details: record.details }),
  }
}

/**
 * A refusal the door words itself (input, a gate): text for the model, the
 * problem for a client. `detail` is the problem's own short sentence when the
 * text is long or words the product's name; the text, otherwise.
 */
export function problemFailure(text: string, status: number, code: string, detail = text): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }], structuredContent: { problem: problemOf(status, { error: detail, code }) } }
}

/** The read gate's problem detail: its refusal text says why, in words the model reads. */
export const READ_GATE_DETAIL = 'The read gate refused this read in this conversation; the text says why.'

/**
 * A refused route call as the tool result: the refuser's own words for the
 * model (errors teach), and the problem for a client.
 */
export function refusalResult(result: OperationResult): CallToolResult {
  const problem = problemOf(result.status, result.body)
  const body = isRecord(result.body) ? result.body : {}
  const message = typeof body.error === 'string' ? body.error : typeof body.detail === 'string' ? body.detail : `The server answered HTTP ${result.status}.`
  const code = typeof body.code === 'string' ? `, ${body.code}` : ''
  const details = problem.details === undefined ? '' : `\nDetails: ${JSON.stringify(problem.details)}`
  return {
    isError: true,
    content: [{ type: 'text', text: `${message} (HTTP ${result.status}${code})${details}` }],
    structuredContent: { problem },
  }
}
