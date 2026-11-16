import { act, render, screen } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import { useAnswerRevealStore } from '../stores/answer-reveal-store'
import { IDLE_AFTER_MS } from '../hooks/use-paced-text'
import { AgentResponse } from './AgentResponse'

vi.mock('../hooks/use-paced-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-paced-text')>()
  return {
    ...actual,
    usePacedText: (
      text: string,
      streaming: boolean,
      _enabled?: boolean,
      stopped?: boolean,
      id?: string,
      leadChars?: number
    ) => actual.usePacedText(text, streaming, true, stopped, id, leadChars),
  }
})

vi.mock('../store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) => {
    const state: DeepPartial<ChatStoreWithHydration> = {
      currentConversation: null,
      projectId: null,
      patchConversationMessage: vi.fn(),
    }
    return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
  }),
}))

vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ accessToken: null }) }))
vi.mock('./AnswerFeedback', () => ({ AnswerFeedback: () => null }))

const animations = vi.hoisted(() => [] as { keyframes: unknown; stops: number }[])
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>()
  return {
    ...actual,
    animate: ((...args: Parameters<typeof actual.animate>) => {
      const record = { keyframes: args[1], stops: 0 }
      animations.push(record)
      const controls = (actual.animate as (...a: unknown[]) => { stop: () => void })(...args)
      const stop = controls.stop.bind(controls)
      controls.stop = () => {
        record.stops += 1
        stop()
      }
      return controls
    }) as typeof actual.animate,
  }
})

const pluginLists = new Set<unknown>()
vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({
    content,
    caret,
    remarkPlugins,
  }: {
    content: string
    caret?: React.ReactNode
    remarkPlugins?: unknown
  }) => {
    pluginLists.add(remarkPlugins)
    return (
      <span data-testid="prose">
        {content}
        {caret}
      </span>
    )
  },
}))

const FRAME_MS = 16
const STREAMED = 'Ein zweiter Fluchtweg ist erforderlich, wenn das Fluchtniveau über 11 m liegt. '
const FINAL = `${STREAMED}Ausnahmen regelt die OIB-RL 2 für Gebäude der Gebäudeklassen 1 und 2.`

const answer = (content: string, isStreaming: boolean) => (
  <AgentResponse content={content} isStreaming={isStreaming} messageId="m-1" />
)

describe('the end of a streamed answer', () => {
  let signal: (string | null)[]
  let unsubscribe: () => void

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
    })
    useAnswerRevealStore.setState({ revealingId: null })
    signal = []
    unsubscribe = useAnswerRevealStore.subscribe((s, prev) => {
      if (s.revealingId !== prev.revealingId) signal.push(s.revealingId)
    })
  })
  afterEach(() => {
    unsubscribe()
    vi.useRealTimers()
  })

  it('settles only after the reveal reaches the end, and signals the settle once', () => {
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 6))
    expect(useAnswerRevealStore.getState().revealingId).toBe('m-1')

    rerender(answer(FINAL, false))
    const steps: { shown: string; copy: boolean; revealing: boolean }[] = []
    const look = () =>
      steps.push({
        shown: screen.getByTestId('prose').textContent ?? '',
        copy: screen.queryByRole('button', { name: 'Copy answer' }) !== null,
        revealing: useAnswerRevealStore.getState().revealingId === 'm-1',
      })
    look()
    for (let t = 0; t < 1500; t += FRAME_MS) {
      act(() => vi.advanceTimersByTime(FRAME_MS))
      look()
    }

    expect(steps[0]!.shown.length).toBeLessThan(FINAL.length)
    expect(steps[0]!.copy).toBe(false)
    expect(new Set(steps.map((s) => s.shown.length)).size).toBeGreaterThan(3)
    for (const step of steps) {
      expect(step.copy).toBe(step.shown === FINAL)
      expect(step.revealing).toBe(step.shown !== FINAL)
    }
    expect(steps.at(-1)!.shown).toBe(FINAL)
    expect(signal).toEqual(['m-1', null])
  })

  it('settles at once when all the prose is shown and the terminal only adds its sources', () => {
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByTestId('prose').textContent).toBe(STREAMED)
    rerender(answer(`${STREAMED}\n\n## Quellen\n\n1. OIB-Richtlinie 2, Ausgabe Mai 2023`, false))
    expect(screen.getByRole('button', { name: /Copy answer/ })).toBeInTheDocument()
    expect(useAnswerRevealStore.getState().revealingId).toBeNull()
    expect(signal).toEqual(['m-1', null])
  })

  it('never signals a reveal for an answer that mounts finished', () => {
    render(answer(FINAL, false))
    act(() => vi.advanceTimersByTime(FRAME_MS * 4))
    expect(signal).toEqual([])
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument()
  })

  it('hands the renderer a caret that stands solid while words advance and breathes in a pause', () => {
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 6))
    const caret = () => screen.queryByTestId('streaming-caret')
    expect(screen.getByTestId('prose')).toContainElement(caret())
    expect(caret()?.closest('[class*=":inline"]')).toBeNull()
    expect(caret()).not.toHaveAttribute('data-idle')
    act(() => vi.advanceTimersByTime(3000))
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS))
    expect(caret()).toHaveAttribute('data-idle', 'true')
    rerender(answer(FINAL, false))
    act(() => vi.advanceTimersByTime(1500))
    expect(caret()).toBeNull()
  })

  it('ends the reveal when the answer goes away mid-stream', () => {
    const { unmount } = render(answer(STREAMED, true))
    expect(useAnswerRevealStore.getState().revealingId).toBe('m-1')
    unmount()
    expect(useAnswerRevealStore.getState().revealingId).toBeNull()
  })

  it('hands the renderer the same plugin list from the first word through the settle', () => {
    pluginLists.clear()
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 6))
    rerender(answer(FINAL, false))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByTestId('prose').textContent).toBe(FINAL)
    expect(pluginLists.size).toBe(1)
  })

  it('holds the copy actions in the row while live, unseen and inert, and hands them over at the settle', () => {
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 6))
    const held = document.querySelector('[aria-label="Copy answer"]')
    expect(held).not.toBeNull()
    expect(held?.closest('[inert]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy answer' })).toBeNull()

    rerender(answer(FINAL, false))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBe(held)
    expect(held?.closest('[inert]')).toBeNull()
  })

  it('keeps no room for the footer while the answer fits the viewport, and opens it at the settle', () => {
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 6))
    const room = () => screen.getByTestId('answer-footer').parentElement
    expect(room()).toHaveAttribute('data-open', 'false')
    rerender(answer(FINAL, false))
    act(() => vi.advanceTimersByTime(1500))
    expect(room()).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('answer-footer')).not.toHaveClass('invisible')
  })

  it('keeps the footer room, unseen, once the answer reaches below the viewport', () => {
    const below = window.innerHeight + 200
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: 0, bottom: below, left: 0, right: 0, width: 0, height: below, x: 0, y: 0, toJSON: () => ({}) })
    try {
      render(answer(STREAMED, true))
      expect(screen.getByTestId('answer-footer').parentElement).toHaveAttribute('data-open', 'true')
      expect(screen.getByTestId('answer-footer')).toHaveClass('invisible')
    } finally {
      rect.mockRestore()
    }
  })

  it('claims completeness only once settled: busy while live, named and idle after', () => {
    const { rerender } = render(answer(STREAMED, true))
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    rerender(answer(FINAL, false))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByRole('article')).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('article')).toHaveAccessibleName('Result')
  })

  it('after Stop, keeps what was on screen, says so, and does not claim to be complete', () => {
    const { rerender } = render(answer(STREAMED, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 4))
    const atStop = screen.getByTestId('prose').textContent ?? ''
    expect(atStop.length).toBeLessThan(STREAMED.length)

    const stoppedAnswer = (content: string) => (
      <AgentResponse content={content} messageId="m-1" stopped />
    )
    rerender(stoppedAnswer(STREAMED))
    expect(screen.getByTestId('prose').textContent).toBe(atStop)
    rerender(stoppedAnswer(FINAL))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByTestId('prose').textContent).toBe(atStop)
    expect(screen.getByTestId('answer-stopped')).toHaveTextContent('Stopped')
    expect(useAnswerRevealStore.getState().revealingId).toBeNull()
  })

  it('does not fade the body in again when Stop freezes it', () => {
    const cited = 'Ein zweiter Fluchtweg ist erforderlich [1] und '
    const { rerender } = render(answer(cited, true))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByTestId('prose').textContent).toBe(cited)

    animations.length = 0
    rerender(
      <AgentResponse content="Ein zweiter Fluchtweg ist erforderlich und " messageId="m-1" stopped />
    )
    act(() => vi.advanceTimersByTime(1000))
    const fades = animations.filter(({ keyframes }) => JSON.stringify(keyframes) === JSON.stringify({ opacity: [0, 1] }))
    expect(fades).toEqual([])
  })

  it('never stops the fade of a rewritten body part-way while the rest is revealed', () => {
    const streamed = 'Holzbau Wien ist ein Holzbauprojekt [1]. Der Fassadenschnitt zeigt keine Holzkonstruktion [2]. '
    const { rerender } = render(answer(streamed, true))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByTestId('prose').textContent).toBe(streamed)

    animations.length = 0
    const settled = `Holzbau Wien ist ein Holzbauprojekt. Der Fassadenschnitt zeigt keine Holzkonstruktion [1]. ${STREAMED.repeat(4)}`
    rerender(answer(settled, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 20))
    rerender(answer(settled, false))
    act(() => vi.advanceTimersByTime(3000))

    expect(screen.getByTestId('prose').textContent).toBe(settled)
    const fades = animations.filter(({ keyframes }) => JSON.stringify(keyframes) === JSON.stringify({ opacity: [0, 1] }))
    expect(fades).toHaveLength(1)
    expect(fades[0].stops).toBe(0)
  })
})

describe('an answer mounting mid-turn', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
    })
  })
  afterEach(() => vi.useRealTimers())

  it('shows 2000 characters that had already arrived at once', () => {
    const arrived = STREAMED.repeat(Math.ceil(2000 / STREAMED.length))
    render(answer(arrived, true))
    expect(screen.getByTestId('prose').textContent).toBe(arrived)
    expect(screen.getByTestId('streaming-caret')).toBeInTheDocument()
  })
})

describe('a summary that leads a fresh answer', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
    })
  })
  afterEach(() => vi.useRealTimers())

  const SUMMARY =
    'Für ein konkretes Vorhaben ist zuerst der passende Teil nach Nutzung und Gebäudeart zu bestimmen; ob die Ausgabe im Bundesland gilt, ist gesondert zu prüfen.'
  const META = { v: 1 as const, kind: 'walkthrough' as const, summary: SUMMARY }
  const headed = (content: string, isStreaming: boolean) => (
    <AgentResponse
      content={content}
      isStreaming={isStreaming}
      messageId="m-sum"
      answerMeta={META}
    />
  )
  const standfirst = () => screen.queryByText((_, el) => el?.tagName === 'P' && el.closest('header') !== null)

  it('writes the summary in word by word, with the caret, before the prose begins', () => {
    const { rerender } = render(headed(STREAMED, true))
    const lengths: number[] = []
    let proseBeforeSummary = false
    for (let t = 0; t < 4000; t += FRAME_MS) {
      act(() => vi.advanceTimersByTime(FRAME_MS))
      const shown = standfirst()?.textContent ?? ''
      lengths.push(shown.length)
      if (shown.length < SUMMARY.length && (screen.getByTestId('prose').textContent ?? '') !== '') proseBeforeSummary = true
      if (shown.length > 0 && shown.length < SUMMARY.length) {
        expect(standfirst()!.querySelector('[data-testid="streaming-caret"]')).not.toBeNull()
      }
    }
    expect(new Set(lengths.filter((n) => n > 0 && n < SUMMARY.length)).size).toBeGreaterThan(3)
    expect(proseBeforeSummary).toBe(false)
    expect(standfirst()!.textContent).toBe(SUMMARY)
    expect(screen.getByTestId('prose').textContent).toBe(STREAMED)
    rerender(headed(FINAL, false))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByTestId('prose').textContent).toBe(FINAL)
    expect(standfirst()!.textContent).toBe(SUMMARY)
  })

  it('keeps the masthead and the summary as far as it was written when stopped under it', () => {
    const { rerender } = render(headed('', true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 6))
    const atStop = standfirst()?.textContent ?? ''
    expect(atStop.length).toBeGreaterThan(0)
    expect(atStop.length).toBeLessThan(SUMMARY.length)

    rerender(
      <AgentResponse content="" messageId="m-sum" answerMeta={META} stopped />
    )
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(standfirst()!.textContent).toBe(atStop)
    expect(screen.getByTestId('answer-stopped')).toBeInTheDocument()
  })

  it('draws a stored stopped answer that holds only its masthead', () => {
    render(<AgentResponse content="" messageId="m-sum" answerMeta={META} stopped />)
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(standfirst()!.textContent).toBe(SUMMARY)
  })

  it('draws a stored answer with its summary whole', () => {
    render(headed(FINAL, false))
    expect(standfirst()!.textContent).toBe(SUMMARY)
    expect(screen.getByTestId('prose').textContent).toBe(FINAL)
  })
})

describe('a retracted round', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
    })
  })
  afterEach(() => vi.useRealTimers())

  const PREAMBLE = 'Ich sehe mir dazu die Richtlinie an und prüfe die Fluchtwege. '
  const ledeOn = () => screen.getByTestId('prose').parentElement!.className.includes('p:first-child')

  it('keeps the card, fades the words into one quiet line, and lets the next round decide its lede', async () => {
    const { rerender } = render(answer(PREAMBLE, true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 30))
    expect(ledeOn()).toBe(true)

    rerender(answer('', true))
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByTestId('prose').textContent).not.toBe('')
    expect(screen.queryByTestId('streaming-caret')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('answer-retracting')).toHaveTextContent('Working on a response …')
    expect(screen.getByTestId('prose').textContent).toBe('')

    rerender(answer('## Fluchtwege\n\nIn Gebäudeklasse 4 gilt ', true))
    act(() => vi.advanceTimersByTime(FRAME_MS * 30))
    expect(screen.queryByTestId('answer-retracting')).toBeNull()
    expect(screen.getByTestId('prose').textContent).toContain('Fluchtwege')
    expect(ledeOn()).toBe(false)
  })
})
