import { describe, expect, test, vi } from 'vitest'
import { PERMISSION_QUERY_LIMIT_MS, detectRecordingSupport, isMicrophoneDenied } from './recording-support'

const mic = { mediaDevices: { getUserMedia: () => undefined } }
const recorder = (supported: string[]) => ({ isTypeSupported: (type: string) => supported.includes(type) })

describe('detectRecordingSupport', () => {
  test('Chromium-style browsers record WebM/Opus', () => {
    expect(
      detectRecordingSupport({ navigator: mic, MediaRecorder: recorder(['audio/webm;codecs=opus', 'audio/webm']) }),
    ).toEqual({ available: true, mimeType: 'audio/webm;codecs=opus', format: 'webm' })
  })

  test('Safari-style browsers record MP4, sent as m4a', () => {
    expect(detectRecordingSupport({ navigator: mic, MediaRecorder: recorder(['audio/mp4']) })).toEqual({
      available: true,
      mimeType: 'audio/mp4',
      format: 'm4a',
    })
  })

  test('no supported container disables the button', () => {
    expect(detectRecordingSupport({ navigator: mic, MediaRecorder: recorder(['audio/wav']) })).toEqual({
      available: false,
      reason: 'noFormat',
    })
  })

  test('no microphone API or no recorder is unsupported', () => {
    expect(detectRecordingSupport({ navigator: {}, MediaRecorder: recorder(['audio/webm']) })).toMatchObject({
      reason: 'unsupported',
    })
    expect(detectRecordingSupport({ navigator: mic })).toMatchObject({ reason: 'unsupported' })
    expect(detectRecordingSupport(undefined)).toMatchObject({ reason: 'unsupported' })
  })

  test('an insecure page says so rather than blaming the browser', () => {
    expect(detectRecordingSupport({ isSecureContext: false, navigator: {} })).toMatchObject({ reason: 'insecure' })
  })
})

describe('isMicrophoneDenied', () => {
  test('reads a denied permission without prompting', async () => {
    await expect(isMicrophoneDenied({ query: async () => ({ state: 'denied' }) })).resolves.toBe(true)
    await expect(isMicrophoneDenied({ query: async () => ({ state: 'prompt' }) })).resolves.toBe(false)
  })

  test('a browser that cannot answer is not treated as denied', async () => {
    await expect(isMicrophoneDenied(undefined)).resolves.toBe(false)
    await expect(
      isMicrophoneDenied({
        query: async () => {
          throw new TypeError('microphone is not a valid permission name')
        },
      }),
    ).resolves.toBe(false)
  })

  // Seen as a permission query that never settles: the button stayed disabled for good.
  test('a query that never answers is not treated as denied, after a short wait', async () => {
    vi.useFakeTimers()
    try {
      const answer = vi.fn<(denied: boolean) => void>()
      void isMicrophoneDenied({ query: () => new Promise(() => {}) }).then(answer)
      await vi.advanceTimersByTimeAsync(PERMISSION_QUERY_LIMIT_MS - 1)
      expect(answer).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(answer.mock.calls).toEqual([[false]])
    } finally {
      vi.useRealTimers()
    }
  })

  test('an answer in time leaves no timer behind', async () => {
    vi.useFakeTimers()
    try {
      await expect(isMicrophoneDenied({ query: async () => ({ state: 'denied' }) })).resolves.toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
