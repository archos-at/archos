/** RFC 9457 problems for the office's base-knowledge operations (ADR-0158). */

import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { PROBLEM_CONTENT_TYPE, asProblem, toProblem } from './problem'

describe('a refusal as a problem', () => {
  it('carries the RFC 9457 members and the app’s own error and code', () => {
    expect(toProblem(new ConflictError('This entry is already confirmed; edit it instead.'))).toEqual({
      type: 'urn:problem-type:base-knowledge:conflict',
      title: 'Conflict',
      status: 409,
      detail: 'This entry is already confirmed; edit it instead.',
      code: 'CONFLICT',
      error: 'This entry is already confirmed; edit it instead.',
    })
    expect(toProblem(new UnprocessableError('needs attestation', { field: 'licenceAttested' })).details).toEqual({
      field: 'licenceAttested',
    })
  })

  it('answers a refusal as application/problem+json with its status, and lets anything else through', async () => {
    const response = (await asProblem(async () => {
      throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
    })) as Response
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe(PROBLEM_CONTENT_TYPE)
    expect(await response.json()).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await asProblem(async () => ({ ok: true }))).toEqual({ ok: true })
    await expect(asProblem(async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })
})
