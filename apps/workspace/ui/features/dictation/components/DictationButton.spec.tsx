/**
 * The microphone button against a fake browser: a `MediaRecorder` that records
 * whatever the test hands it, a microphone that grants or refuses, and an
 * optional level meter. What it pins is the contract with the composer: text
 * through `onTranscript`, a message through `onError`, nothing for silence.
 */

import { act, fireEvent, render, screen, waitFor } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MAX_DICTATION_SECONDS } from '@/lib/dictation/contract'
import { WAVE_BARS, waveHeight } from '../hooks/use-dictation'
import { MICROPHONE_ANSWER_LIMIT_MS, STOP_LIMIT_MS } from '../lib/dictation-machine'
import { PERMISSION_QUERY_LIMIT_MS } from '../lib/recording-support'
import { DictationButton } from './DictationButton'
import { PRODUCT_NAME } from '@/lib/brand'

class FakeRecorder {
  static supported = ['audio/webm;codecs=opus', 'audio/webm']
  static isTypeSupported = (type: string) => FakeRecorder.supported.includes(type)
  static last: FakeRecorder | null = null
  /** A recorder that hands over its data but never reports that it stopped. */
  static reportsStop = true
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream, options: { mimeType: string }) {
    this.mimeType = options.mimeType
    FakeRecorder.last = this
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) })
    if (FakeRecorder.reportsStop) this.onstop?.()
  }
}

const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] } as unknown as MediaStream
const getUserMedia = vi.fn(async () => stream)
const fetchMock = vi.fn<typeof fetch>()

function installBrowser() {
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  vi.stubGlobal('fetch', fetchMock)
}

/** A Web Audio meter that reads `level` on every sample. */
function installMeter(level: number) {
  class FakeAudioContext {
    state = 'running'
    createAnalyser() {
      return {
        fftSize: 0,
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(level),
      }
    }
    createMediaStreamSource() {
      return { connect: () => {} }
    }
    resume() {
      return Promise.resolve()
    }
    close() {
      return Promise.resolve()
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
}

function renderButton(extra: { onExplain?: (reason: string) => void } = {}) {
  const onTranscript = vi.fn()
  const onError = vi.fn()
  render(<DictationButton locale="de" onTranscript={onTranscript} onError={onError} {...extra} />)
  return { onTranscript, onError }
}

async function recordFor(ms: number) {
  fireEvent.click(await screen.findByTestId('dictation-button'))
  await screen.findByTestId('dictation-recording')
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  FakeRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm']
  FakeRecorder.reportsStop = true
  track.stop.mockClear()
  getUserMedia.mockReset().mockResolvedValue(stream)
  fetchMock.mockReset()
  installBrowser()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window.navigator, 'permissions')
})

/** A microphone the test answers by hand: an open permission prompt. */
function pendingMicrophone() {
  let grant!: (granted: MediaStream) => void
  let refuse!: (error: unknown) => void
  getUserMedia.mockReturnValue(
    new Promise<MediaStream>((resolve, reject) => {
      grant = resolve
      refuse = reject
    }),
  )
  return { grant, refuse }
}

describe('DictationButton', () => {
  test('records, stops on the second press and hands back the transcript', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: 'Prüf das Stiegenhaus.' })))
    const { onTranscript, onError } = renderButton()

    await recordFor(2000)
    fireEvent.click(screen.getByTestId('dictation-recording'))

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Prüf das Stiegenhaus.'))
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dictation')
    const form = init?.body as FormData
    expect((form.get('audio') as File).type).toBe('audio/webm;codecs=opus')
    expect(form.get('locale')).toBe('de')
  })

  test(`stops by itself after ${MAX_DICTATION_SECONDS} seconds`, async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: 'Lang.' })))
    const { onTranscript } = renderButton()

    await recordFor(MAX_DICTATION_SECONDS * 1000 + 50)

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Lang.'))
    expect(FakeRecorder.last?.state).toBe('inactive')
  })

  test('a silent recording is never sent and inserts nothing', async () => {
    installMeter(0.001)
    const { onTranscript, onError } = renderButton()

    await recordFor(3000)
    fireEvent.click(screen.getByTestId('dictation-recording'))

    await screen.findByTestId('dictation-button')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  test('speech above the silence floor is sent', async () => {
    installMeter(0.2)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: 'Laut genug.' })))
    const { onTranscript } = renderButton()

    await recordFor(1500)
    fireEvent.click(screen.getByTestId('dictation-recording'))

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Laut genug.'))
  })

  test('the waveform follows the microphone while recording', async () => {
    installMeter(0.25)
    renderButton()

    await recordFor(1000)

    const bars = screen.getByTestId('dictation-recording').querySelectorAll('[aria-hidden="true"] > span')
    expect(bars).toHaveLength(WAVE_BARS)
    // The newest sample is on the right and is a raised voice: full height.
    expect((bars[bars.length - 1] as HTMLElement).style.transform).toBe('scaleY(1.00)')
  })

  test('wave heights: silence is flat, quiet speech still moves, loud speech caps', () => {
    expect(waveHeight(0)).toBe(0)
    expect(waveHeight(0.02)).toBeGreaterThan(0.25)
    expect(waveHeight(5)).toBe(1)
  })

  test('a failed transcription is an inline error, never text', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 502 }))
    const { onTranscript, onError } = renderButton()

    await recordFor(1500)
    fireEvent.click(screen.getByTestId('dictation-recording'))

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('The recording could not be transcribed. Your message is unchanged.'),
    )
    expect(onTranscript).not.toHaveBeenCalled()
    await screen.findByTestId('dictation-button')
  })

  test('a refused microphone disables the button and says why', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const { onError } = renderButton()

    fireEvent.click(await screen.findByTestId('dictation-button'))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Microphone access was not allowed.'))
    const unavailable = await screen.findByTestId('dictation-unavailable')
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')
    expect(unavailable.getAttribute('aria-label')).toMatch(/Microphone access is blocked/)
  })

  test('a browser with no usable audio format gets a disabled button with the reason', async () => {
    FakeRecorder.supported = []
    renderButton()

    const unavailable = await screen.findByTestId('dictation-unavailable')
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')
    expect(unavailable.getAttribute('aria-label')).toMatch(
      new RegExp(`records no audio format ${PRODUCT_NAME} can transcribe`)
    )
  })

  // A touch screen has no hover: the tooltip never shows there, and a disabled
  // button answers a finger with nothing. Pressing it has to say why.
  test('pressing an unavailable microphone hands the reason to the composer, and records nothing', async () => {
    FakeRecorder.supported = []
    const onExplain = vi.fn()
    renderButton({ onExplain })

    fireEvent.click(await screen.findByTestId('dictation-unavailable'))

    expect(onExplain).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(String.raw`records no audio format ${PRODUCT_NAME} can transcribe`))
    )
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  describe('a microphone that does not answer', () => {
    test('a second press gives up, and a late grant is released unused', async () => {
      const { grant } = pendingMicrophone()
      const { onError } = renderButton()

      fireEvent.click(await screen.findByTestId('dictation-button'))
      const waiting = await screen.findByRole('button', { name: /Waiting for the microphone/ })
      expect(waiting.getAttribute('aria-busy')).toBe('true')
      expect((waiting as HTMLButtonElement).disabled).toBe(false)

      fireEvent.click(waiting)
      await screen.findByRole('button', { name: 'Dictate' })
      expect(onError).not.toHaveBeenCalled()

      await act(async () => {
        grant(stream)
      })
      expect(track.stop).toHaveBeenCalled()
      expect(FakeRecorder.last?.state).not.toBe('recording')
      expect(screen.queryByTestId('dictation-recording')).toBeNull()
    })

    test('a refusal that lands after giving up says nothing', async () => {
      const { refuse } = pendingMicrophone()
      const { onError } = renderButton()

      fireEvent.click(await screen.findByTestId('dictation-button'))
      fireEvent.click(await screen.findByRole('button', { name: /Waiting for the microphone/ }))
      await act(async () => {
        refuse(new DOMException('denied', 'NotAllowedError'))
      })

      expect(onError).not.toHaveBeenCalled()
      await screen.findByRole('button', { name: 'Dictate' })
    })

    test('a read-only composer can still give up on it', async () => {
      pendingMicrophone()
      const view = render(<DictationButton locale="de" onTranscript={vi.fn()} onError={vi.fn()} />)

      fireEvent.click(await screen.findByTestId('dictation-button'))
      await screen.findByRole('button', { name: /Waiting for the microphone/ })
      view.rerender(<DictationButton locale="de" disabled onTranscript={vi.fn()} onError={vi.fn()} />)

      const waiting = screen.getByRole('button', { name: /Waiting for the microphone/ }) as HTMLButtonElement
      expect(waiting.disabled).toBe(false)
      fireEvent.click(waiting)
      const idle = (await screen.findByRole('button', { name: 'Dictate' })) as HTMLButtonElement
      expect(idle.disabled).toBe(true)
    })

    test('ends by itself after the answer limit and says the microphone did not answer', async () => {
      pendingMicrophone()
      const { onError } = renderButton()

      fireEvent.click(await screen.findByTestId('dictation-button'))
      await screen.findByRole('button', { name: /Waiting for the microphone/ })
      await act(async () => {
        vi.advanceTimersByTime(MICROPHONE_ANSWER_LIMIT_MS)
      })

      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/^The microphone did not answer\./))
      await screen.findByRole('button', { name: 'Dictate' })
    })

    test('a refusal that lands after the button is gone says nothing', async () => {
      const { refuse } = pendingMicrophone()
      const onError = vi.fn()
      const view = render(<DictationButton locale="de" onTranscript={vi.fn()} onError={onError} />)

      fireEvent.click(await screen.findByTestId('dictation-button'))
      await screen.findByRole('button', { name: /Waiting for the microphone/ })
      view.unmount()
      await act(async () => {
        refuse(new DOMException('denied', 'NotAllowedError'))
      })

      expect(onError).not.toHaveBeenCalled()
    })
  })

  test('a permission query that never answers does not keep the button disabled', async () => {
    Object.defineProperty(window.navigator, 'permissions', {
      value: { query: () => new Promise(() => {}) },
      configurable: true,
    })
    renderButton()

    expect(screen.getByTestId('dictation-unavailable')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PERMISSION_QUERY_LIMIT_MS)
    })

    expect(screen.queryByTestId('dictation-unavailable')).toBeNull()
    expect((screen.getByTestId('dictation-button') as HTMLButtonElement).disabled).toBe(false)
  })

  test('a recorder that never reports its stop is finished with what it captured', async () => {
    FakeRecorder.reportsStop = false
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: 'Trotzdem da.' })))
    const { onTranscript, onError } = renderButton()

    await recordFor(2000)
    fireEvent.click(screen.getByTestId('dictation-recording'))
    await act(async () => {
      vi.advanceTimersByTime(STOP_LIMIT_MS)
    })

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Trotzdem da.'))
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    await screen.findByTestId('dictation-button')
  })
})
