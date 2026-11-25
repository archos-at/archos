import { describe, expect, it } from 'vitest'
import { FIRST_PLACE, isPlace, landingPath } from './landing'
import { NEW_PERSONAL_CHAT_HREF } from './rail-mode'

describe('where /app lands', () => {
  it('opens Persönlich > Neuer Chat the first time', () => {
    expect(FIRST_PLACE).toBe(NEW_PERSONAL_CHAT_HREF)
    expect(landingPath(undefined)).toBe(NEW_PERSONAL_CHAT_HREF)
  })

  it('opens a new chat in the project the person last worked in, whichever page of it that was', () => {
    expect(landingPath(encodeURIComponent('/app/projects/p1/files'))).toBe('/app/projects/p1/chat?new=1')
    expect(landingPath('/app/projects/p1/chat?session=c9')).toBe('/app/projects/p1/chat?new=1')
  })

  it('opens a new personal chat when the last place was personal or outside a project', () => {
    expect(landingPath('/app/personal-shelf')).toBe(NEW_PERSONAL_CHAT_HREF)
    expect(landingPath('/app/personal/chat?session=c1')).toBe(NEW_PERSONAL_CHAT_HREF)
    expect(landingPath('/app/office-shelf')).toBe(NEW_PERSONAL_CHAT_HREF)
  })

  it('never builds a path from a project id that is not one', () => {
    expect(landingPath(encodeURIComponent('/app/projects/a%2F..%2F..%2Fevil/files'))).toBe(NEW_PERSONAL_CHAT_HREF)
  })

  it.each([
    ['another site', 'https://example.com/app/x'],
    ['a protocol-relative path', '//example.com/app'],
    ['the overview itself', '/app/projects'],
    ['the onboarding', '/app/onboarding/welcome'],
    ['a redirect-only route', '/app/chat'],
    ['a path outside the app', '/login'],
    ['an undecodable value', '%E0%A4%A'],
  ])('ignores %s and opens the first place', (_what, value) => {
    expect(landingPath(value)).toBe(FIRST_PLACE)
  })

  it('keeps a query, which is part of a place', () => {
    expect(isPlace('/app/personal/chat?session=c1')).toBe(true)
  })
  it('opens Persönlich for a last place whose project cannot be decoded', () => {
    expect(landingPath(encodeURIComponent('/app/projects/%/chat'))).toBe(FIRST_PLACE)
  })
})
