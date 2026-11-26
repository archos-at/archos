/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

import { ApiError, isApiError } from './api-error'
import { isAuthzRefusal, NotFoundError } from './errors'

const loadSecondCopy = async (): Promise<typeof import('./api-error')> => {
  vi.resetModules()
  return import('./api-error')
}

describe('ApiError across bundles', () => {
  it('a refusal thrown by a second copy of the module is still a refusal (KAN-99)', async () => {
    const other = await loadSecondCopy()
    const notFound = new other.ApiError(404, 'NOT_FOUND', 'Not found')

    expect(notFound instanceof ApiError, 'the second copy is a different class, as in the instrumentation bundle').toBe(false)
    expect(isApiError(notFound)).toBe(true)
    expect(isAuthzRefusal(notFound)).toBe(true)
    expect(isAuthzRefusal(new other.ApiError(500, 'INTERNAL', 'boom'))).toBe(false)
  })

  it('recognises its own errors and nothing else', () => {
    expect(isApiError(new NotFoundError())).toBe(true)
    expect(isApiError(new Error('Not found'))).toBe(false)
    expect(isApiError({ status: 404, code: 'NOT_FOUND' })).toBe(false)
    expect(isApiError(null)).toBe(false)
  })

  it('keeps the marker on the class, so a copy of an error is not an ApiError', () => {
    const error = new NotFoundError()
    expect(Reflect.ownKeys(error)).not.toContain(Symbol.for('bff.ApiError'))
    expect(isApiError({ ...error })).toBe(false)
    expect(isApiError(Object.assign({}, error))).toBe(false)
  })
})
