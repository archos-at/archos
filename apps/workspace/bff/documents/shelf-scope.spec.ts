import { describe, expect, it } from 'vitest'
import { BadRequestError } from '@/lib/api/api-error'
import { shelfOf } from './shelf-scope'

const request = (query = '') => new Request(`http://localhost/api/documents${query}`)
const reader = { userId: 'u-me' }

describe('shelfOf', () => {
  it('names the caller’s own shelf for the personal scope, never one the request names', () => {
    expect(shelfOf({ scope: 'personal' }, request(), reader)).toEqual({ kind: 'personal', userId: 'u-me' })
    expect(shelfOf({}, request('?scope=personal'), reader)).toEqual({ kind: 'personal', userId: 'u-me' })
  })

  it('refuses a project on the personal shelf', () => {
    expect(() => shelfOf({ scope: 'personal', projectId: 'p' }, request(), reader)).toThrow(BadRequestError)
  })

  it('keeps the project and the office shelf as before', () => {
    expect(shelfOf({ projectId: 'p' }, request(), reader)).toEqual({ kind: 'project', projectId: 'p' })
    expect(shelfOf({}, request('?scope=office_shelf'), reader)).toEqual({ kind: 'office_shelf' })
    expect(() => shelfOf({}, request(), reader)).toThrow(BadRequestError)
  })
})
