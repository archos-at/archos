import { describe, expect, it } from 'vitest'
import { FIRST_PLACE, isPlace, landingPath } from './landing'
import { NEW_PERSONAL_CHAT_HREF } from './rail-mode'

describe('where /app lands', () => {
  it('opens Persönlich > Neuer Chat the first time', () => {
    expect(FIRST_PLACE).toBe(NEW_PERSONAL_CHAT_HREF)
    expect(landingPath(undefined)).toBe(NEW_PERSONAL_CHAT_HREF)
  })

  it('opens where the person last was', () => {
    expect(landingPath(encodeURIComponent('/app/projects/p1/files'))).toBe('/app/projects/p1/files')
    expect(landingPath('/app/personal-shelf')).toBe('/app/personal-shelf')
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
})
