/**
 * @vitest-environment node
 *
 * Every refusal on the door as an RFC 9457 problem (ADR-0170), whichever shape
 * the route answered: the app's `{ error, code, details }` envelope, a problem
 * the route already wrote, or a bare status.
 */
import { describe, expect, it } from 'vitest'
import { problemOf, refusalResult } from './door-problem'

describe('problemOf', () => {
  it('reads the app’s error envelope as a problem with a type per code', () => {
    expect(problemOf(409, { error: 'You wrote a revision in this change request.', code: 'CONFLICT' })).toEqual({
      type: 'urn:problem-type:conflict',
      title: 'Conflict',
      status: 409,
      detail: 'You wrote a revision in this change request.',
      code: 'CONFLICT',
    })
  })

  it('keeps a route’s own problem, its type and its details', () => {
    const route = { type: 'urn:problem-type:base-knowledge:unprocessable', title: 'Unprocessable Content', status: 422, detail: 'failed', code: 'UNPROCESSABLE', error: 'failed', details: { results: [] } }
    expect(problemOf(422, route)).toMatchObject({ type: route.type, detail: 'failed', details: { results: [] } })
  })

  it('names a bare status without guessing a cause', () => {
    expect(problemOf(502, null)).toEqual({ type: 'urn:problem-type:http_502', title: 'Bad Gateway', status: 502, detail: 'The server answered HTTP 502.', code: 'HTTP_502' })
  })
})

describe('refusalResult', () => {
  it('gives the model the route’s words and a client the problem', () => {
    const result = refusalResult({ status: 403, ok: false, body: { error: 'Runs only on the person’s own yes.', code: 'PERSON_DECISION_REQUIRED' } })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Runs only on the person’s own yes. (HTTP 403, PERSON_DECISION_REQUIRED)' }])
    expect(result.structuredContent).toMatchObject({ problem: { status: 403, code: 'PERSON_DECISION_REQUIRED' } })
  })
})
