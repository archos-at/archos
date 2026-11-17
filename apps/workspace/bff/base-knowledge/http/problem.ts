import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/errors'

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

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

export async function asProblem<T>(run: () => Promise<T>): Promise<T | Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ApiError) return problemResponse(error)
    throw error
  }
}
