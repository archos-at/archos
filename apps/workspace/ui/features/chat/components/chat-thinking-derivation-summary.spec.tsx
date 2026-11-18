import { render, screen, within } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { useLayoutStore } from '@/features/layout/store'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import {
  failedCallCitations,
  failedCallScene,
  foldScene,
  mockupCitations,
  mockupScene,
  singleReadCitations,
  singleReadScene,
} from '@/test-utils/work-list-scenes'
import { plain, tEn } from './chat-thinking.fixtures'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

describe('ChatThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayoutStore.setState({ showTechnicalReasoning: false })
    motionPref.reduced = false
  })

  describe('the header at a glance (2026-10)', () => {
    test('settled: the steps, what the answer cites, and the one worst warning', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          isThinking={false}
        />
      )
      const trigger = screen.getByRole('button')
      expect(within(trigger).getByText(/^Trace ·/)).toHaveTextContent(
        'Trace · 2 steps · 3 sources cited'
      )
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent(
        plain(tEn('thinking.derivationWarning.open', { count: 1 }))
      )
      expect(trigger).toHaveAccessibleName(
        new RegExp(
          `^Done · Trace\u00A0· 2\\ssteps\u00A0· 3\\ssources cited · ${tEn('thinking.derivationWarning.open', { count: 1 })}$`
        )
      )
      expect(within(trigger).getByText(/^Trace/).textContent).toMatch(/^Trace\u00A0· 2\ssteps\u00A0· /)
    })

    test('a failed call outranks an open point', () => {
      render(
        <ChatThinking
          steps={foldScene(failedCallScene())}
          citations={failedCallCitations()}
          isThinking={false}
        />
      )
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent('1 call failed')
    })

    test('no warning while the turn works', () => {
      render(<ChatThinking steps={foldScene(failedCallScene())} isThinking />)
      expect(screen.queryByTestId('derivation-warning')).not.toBeInTheDocument()
    })

    const check = (level: 'low' | 'medium', count = 2): ConfidenceCheck => ({
      status: 'judged',
      level,
      findings: ['Ausgabe April 2019 gilt seit 10. April 2021.', 'Mai 2023 ist nicht verbindlich.']
        .slice(0, count)
        .map((statement) => ({ statement, problem: 'unbacked' as const, reason: '', source: 'none' })),
    })
    const trigger = () => document.querySelector('[data-derivation-trigger]')!

    test('an answer its check rated low for unbacked statements is a warning, not a green check', () => {
      render(
        <ChatThinking
          steps={foldScene(failedCallScene())}
          citations={failedCallCitations()}
          confidenceCheck={check('low')}
          isThinking={false}
        />
      )
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent(
        plain(tEn('thinking.derivationWarning.unbacked', { count: 2 }))
      )
      expect(trigger().querySelector('.text-success')).toBeNull()
      expect(trigger().querySelector('.text-warning')).not.toBeNull()
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.flagged')} · `))
    })

    test('a mostly backed answer keeps its check, and the pill names what is unbacked', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          confidenceCheck={check('medium', 1)}
          isThinking={false}
        />
      )
      expect(trigger().querySelector('.text-success')).not.toBeNull()
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent(
        plain(tEn('thinking.derivationWarning.unbacked', { count: 1 }))
      )
    })

    test('a clean check keeps the green check', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          confidenceCheck={{ status: 'judged', level: 'high', findings: [] }}
          isThinking={false}
        />
      )
      expect(trigger().querySelector('.text-success')).not.toBeNull()
    })

    test('a general-knowledge answer with findings stays „without research“ and carries the pill', () => {
      render(
        <ChatThinking
          steps={[]}
          confidenceCheck={check('low')}
          answerText="Eine Brandwand trennt Brandabschnitte."
          isThinking={false}
          userQuestion="Was ist eine Brandwand?"
          answerConfidence="low"
        />
      )
      const line = screen.getByTestId('derivation-no-research')
      expect(plain(line.textContent)).toContain(
        `${tEn('thinking.noResearch')} · ${plain(tEn('thinking.derivationWarning.unbacked', { count: 2 }))}`
      )
      expect(line.querySelector('.text-warning')).not.toBeNull()
    })

    const ledger: RetrievalLedger = [
      {
        index: 0,
        key: 'status.retrieval.withQuery',
        tools: ['knowledge_search'],
        corpora: [],
        docs: [{ name: 'Planungsbericht.pdf', detail: 'p.1' }],
        newDocs: ['Planungsbericht.pdf'],
        hits: 1,
        documents: 1,
      },
    ]
    const askBack = 'Das hängt vom Landesrecht ab.\n\nIn welchem Bundesland liegt das Bauvorhaben?'

    test('an answer that read documents and then asked back is a Rückfrage, not „without research“', () => {
      render(
        <ChatThinking
          steps={[]}
          retrievalLedger={ledger}
          confidenceCheck={check('medium', 1)}
          answerText={askBack}
          isThinking={false}
          userQuestion="Welche Ausgabe der OIB-Richtlinie 6 gilt?"
        />
      )
      expect(screen.queryByTestId('derivation-no-research')).not.toBeInTheDocument()
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.askedBack')} · `))
      expect(trigger().querySelector('.text-success')).toBeNull()
      expect(within(screen.getByRole('button')).getByText(tEn('thinking.askedBack'))).toBeInTheDocument()
    })

    test('a finding that sinks the answer outranks its question back', () => {
      render(
        <ChatThinking
          steps={[]}
          retrievalLedger={ledger}
          confidenceCheck={check('low')}
          answerText={askBack}
          isThinking={false}
          userQuestion="Welche Ausgabe der OIB-Richtlinie 6 gilt?"
        />
      )
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.flagged')} · `))
    })

    test('a cited answer under an assumption that invites a correction is no Rückfrage', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          answerText={'Ich gehe von Wien aus: mindestens 1,00 m [1].\n\nLiegt das Projekt in einem anderen Bundesland?'}
          isThinking={false}
        />
      )
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.done')} · `))
      expect(trigger().querySelector('.text-success')).not.toBeNull()
    })

    test('an answer that asked back without researching says so in its one line', () => {
      render(
        <ChatThinking
          steps={[]}
          answerText="Welche Brandschutzklasse hat das Gebäude?"
          isThinking={false}
          userQuestion="Brauche ich eine Brandwand?"
          answerConfidence="medium"
        />
      )
      expect(screen.getByTestId('derivation-asked-back')).toHaveTextContent(
        tEn('thinking.askedBackHeadline')
      )
      expect(screen.queryByTestId('derivation-no-research')).not.toBeInTheDocument()
    })

    test('a turn that looked nothing up is one line that opens nothing', () => {
      render(
        <ChatThinking
          steps={[]}
          isThinking={false}
          userQuestion="Was ist eine Brandwand?"
          answerConfidence="medium"
        />
      )
      expect(screen.getByTestId('derivation-no-research')).toHaveTextContent(
        'Answered without researchGeneral expertise, no source cited'
      )
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    test('a turn of one call is that call: no graph', () => {
      render(
        <ChatThinking
          steps={foldScene(singleReadScene())}
          citations={singleReadCitations()}
          isThinking={false}
        />
      )
      const single = screen.getByTestId('derivation-single')
      expect(single).toHaveTextContent('Read: Brandschutzkonzeptp. 7 · cited 1')
      expect(within(single).getByRole('button')).toHaveAttribute('data-citation-marker', '1')
      expect(document.querySelector('[data-derivation-trigger]')).not.toBeInTheDocument()
      expect(screen.queryByTestId('reasoning-flow')).not.toBeInTheDocument()
    })

    test('a turn whose calls are rows has no tool chips beside them', () => {
      render(<ChatThinking steps={foldScene(mockupScene())} isThinking defaultOpen />)
      expect(screen.queryByText('Ran:')).not.toBeInTheDocument()
    })
  })
})
