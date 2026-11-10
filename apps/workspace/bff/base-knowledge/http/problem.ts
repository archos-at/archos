/**
 * RFC 9457 problem details for the office's base-knowledge operations
 * (ADR-0158; S10 extends it to every door operation). A refusal reaches a
 * person, an agent through the door, or another client as
 * `application/problem+json` with `type`, `title`, `status`, `detail`, and the
 * extension members `code` (the stable machine word) and `error` (the message,
 * the field every other route of this app answers with), so a client that reads
 * either shape reads this one.
 */

import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/errors'

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

/** Where a problem type is described; one per stable code, so a client can tell them apart. */
const PROBLEM_TYPE_BASE = 'urn:problem-type:base-knowledge:'

export interface Problem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  error: string
  details?: unknown
}

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
}

export function toProblem(error: ApiError): Problem {
  return {
    type: `${PROBLEM_TYPE_BASE}${error.code.toLowerCase()}`,
    title: TITLES[error.status] ?? 'Error',
    status: error.status,
    detail: error.message,
    code: error.code,
    error: error.message,
    ...(error.details === undefined ? {} : { details: error.details }),
  }
}

export function problemResponse(error: ApiError): Response {
  return NextResponse.json(toProblem(error), { status: error.status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } })
}

/**
 * Run one office operation and answer a refusal as a problem. Anything that is
 * not a refusal (`ApiError`) goes on to the route's own handling, which logs it
 * and answers 500 with its request id.
 */
export async function asProblem<T>(run: () => Promise<T>): Promise<T | Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ApiError) return problemResponse(error)
    throw error
  }
}
