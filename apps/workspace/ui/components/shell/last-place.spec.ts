import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRecordLastPlace } from './last-place'

const written = (): string[] => vi.mocked(cookieSetter).mock.calls.map(([value]) => String(value))
const cookieSetter = vi.spyOn(document, 'cookie', 'set')

afterEach(() => cookieSetter.mockClear())

describe('the shell remembers where the person was, for /app', () => {
  it('records a place, for the app’s paths only and for a year', () => {
    renderHook(() => useRecordLastPlace('/app/projects/p1/files'))
    expect(written()).toEqual([`last_place=${encodeURIComponent('/app/projects/p1/files')}; path=/app; max-age=31536000; samesite=lax`])
  })

  it('does not record the overview or the onboarding, which are not places to come back to', () => {
    renderHook(() => useRecordLastPlace('/app/projects'))
    renderHook(() => useRecordLastPlace('/app/onboarding/welcome'))
    expect(written()).toEqual([])
  })

  it('records only a side’s place, so a page with no side (the Postfach, the profile) keeps the side the person came from', () => {
    renderHook(() => useRecordLastPlace('/app/inbox'))
    renderHook(() => useRecordLastPlace('/app/profile'))
    renderHook(() => useRecordLastPlace('/app/personal/chat'))
    expect(written()).toEqual([`last_place=${encodeURIComponent('/app/personal/chat')}; path=/app; max-age=31536000; samesite=lax`])
  })
})
