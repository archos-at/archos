import { trace, type Span } from '@opentelemetry/api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSTHOG_SESSION_HEADER, browserSessionId, tagSpanWithBrowserSession } from './trace-session'

const SESSION = '0193f5a6-7b2c-7d4e-8f00-1a2b3c4d5e6f'

const request = (value?: string) =>
  new Request('https://app.example/api/projects', value ? { headers: { [POSTHOG_SESSION_HEADER]: value } } : {})

describe('browserSessionId', () => {
  it('reads a PostHog session id, normalised', () => {
    expect(browserSessionId(request(` ${SESSION.toUpperCase()} `))).toBe(SESSION)
  })

  it.each([
    ['no header', undefined],
    ['a UUIDv4', '0193f5a6-7b2c-4d4e-8f00-1a2b3c4d5e6f'],
    ['anything else', 'not-a-session'],
  ])('ignores %s', (_what, value) => {
    expect(browserSessionId(request(value))).toBeUndefined()
  })
})

describe('tagSpanWithBrowserSession', () => {
  afterEach(() => vi.restoreAllMocks())

  const activeSpan = (recording: boolean) => {
    const span = { isRecording: () => recording, setAttribute: vi.fn() }
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span as unknown as Span)
    return span
  }

  it('puts the session on the recording span under the name PostHog reads', () => {
    const span = activeSpan(true)
    tagSpanWithBrowserSession(request(SESSION))
    expect(span.setAttribute).toHaveBeenCalledWith('sessionId', SESSION)
  })

  it('leaves a span the sampler dropped, and a request with no session, alone', () => {
    const dropped = activeSpan(false)
    tagSpanWithBrowserSession(request(SESSION))
    expect(dropped.setAttribute).not.toHaveBeenCalled()
    const recording = activeSpan(true)
    tagSpanWithBrowserSession(request('garbage'))
    expect(recording.setAttribute).not.toHaveBeenCalled()
  })

  it('does nothing without a tracer provider', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined)
    expect(() => tagSpanWithBrowserSession(request(SESSION))).not.toThrow()
  })
})
