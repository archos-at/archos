import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { server } from '@/mocks/server'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import type { ProposedChangeView } from '@/lib/proposals/types'
import type { AnswerCard } from '@/shared/cards/schemas'
import { proposedCalibrationOf } from '../lib/calibration-proposal'
import { AnswerCards } from './AnswerCards'
import { CalibrationReceipt, CLIP_TIMEOUT_MS } from './CalibrationProposalPreview'
import {
  decidedByAnna,
  PROPOSAL_ID,
  proposalBase,
  requests,
  resetKit,
  serve,
  startRecording,
} from './proposal-test-kit'

const pdf = vi.hoisted(() => ({ opened: [] as string[], status: null as number | null, hang: false }))

vi.mock('@/features/knowledge/lib/pdfjs-runtime', () => ({
  documentParameters: (url: string) => ({ url }),
  loadPdfjs: async () => ({
    getDocument: ({ url }: { url: string }) => {
      pdf.opened.push(url)
      return {
        promise: pdf.hang
          ? new Promise(() => undefined)
          : pdf.status !== null
            ? Promise.reject(
                Object.assign(new Error('Unexpected server response'), { status: pdf.status })
              )
            : Promise.resolve({
                numPages: 3,
                getPage: async () => ({
                  getViewport: ({ scale }: { scale: number }) => ({
                    width: 1190.55 * scale,
                    height: 841.89 * scale,
                  }),
                  render: () => ({ cancel: () => {}, promise: Promise.resolve() }),
                }),
              }),
        destroy: async () => {},
      }
    },
  }),
}))

vi.mock('@/features/chat/store', () => {
  const state = {
    projectId: 'proj-1',
    currentConversation: null,
    conversations: [],
    setCardDecision: vi.fn(),
  }
  const useChatStore = (selector: (s: typeof state) => unknown) => selector(state)
  useChatStore.getState = () => state
  return { useChatStore }
})
vi.mock('@/features/chat/hooks/use-project-facts', () => ({
  invalidateProjectFacts: vi.fn(),
  useProjectFacts: () => null,
}))

type OperationProposal = Extract<ProposedChangeView, { kind: 'operation' }>

const DOCUMENT_ID = '3c2b1a0f-9e8d-4c7b-a6f5-4e3d2c1b0a9f'
// Half of an A3 landscape sheet's width is 210 mm of paper: 21 m across it is 1:100.
const BODY = {
  page: 2,
  region: { x: 0.2, y: 0.3, w: 0.6, h: 0.3 },
  from: { x: 0.25, y: 0.45 },
  to: { x: 0.75, y: 0.45 },
  lengthM: 21,
}
const INPUT = { params: { id: DOCUMENT_ID }, body: BODY }
const SUMMARY = 'Set the scale of the drawing (lengthM: 21)'

const calibration = (patch: Partial<OperationProposal> = {}): OperationProposal => ({
  ...proposalBase(),
  kind: 'operation',
  payload: { operation: 'drawing-calibration-set', input: INPUT, summary: SUMMARY },
  targets: [{ type: 'document', id: DOCUMENT_ID, name: 'Grundriss EG.pdf' }],
  ...patch,
})

const card = <CalibrationReceipt proposalId={PROPOSAL_ID} input={INPUT} />
const posts = () => requests.filter((line) => line.startsWith('POST'))

let restore: () => void = () => undefined

beforeEach(() => {
  pdf.opened = []
  pdf.status = null
  pdf.hang = false
  startRecording()
  restore = installLayoutObservers({ frameWidth: 600 })
})
afterEach(() => {
  restore()
  resetKit()
})

describe('a proposed calibration, clip drawn', () => {
  it('asks the one question and says what a yes means, with nothing of the call in sight', async () => {
    serve(calibration())
    const { container } = render(card)

    expect(await screen.findByTestId('calibration-meaning')).toHaveTextContent(
      /^Then \S+ works out every measurement in this area at scale 1:100\. So far it is estimated\.$/
    )
    expect(screen.getByText('Confirm the scale')).toBeInTheDocument()
    expect(screen.getByTestId('calibration-question')).toHaveTextContent(
      /^Is the marked length 21\.00\sm\?$/
    )
    expect(screen.getByTestId('calibration-question')).toHaveClass('text-section')
    const caption = screen.getByTestId('calibration-caption')
    expect(within(caption).getByTitle('Grundriss EG.pdf')).toBeInTheDocument()
    expect(caption).toHaveTextContent(/ · page 2$/)
    expect(caption).toHaveClass('text-meta')
    expect(
      screen.getByRole('img', { name: 'Page 2, clip with the marked length' })
    ).toBeInTheDocument()
    expect(pdf.opened).toEqual([`/api/documents/${DOCUMENT_ID}/file`])

    expect(screen.queryByTestId('operation-input')).toBeNull()
    expect(container).not.toHaveTextContent('drawing-calibration-set')
    expect(container).not.toHaveTextContent(SUMMARY)
    expect(container).not.toHaveTextContent('Apply')
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    expect(screen.getByTestId('proposal-footnote')).toHaveTextContent(
      'Dismiss: the scale stays estimated.'
    )
  })

  it('asks it in German, the length as German writes it', async () => {
    serve(calibration())
    render(
      <I18nProvider initialLocale="de" fixedLocale>
        {card}
      </I18nProvider>
    )
    expect(await screen.findByTestId('calibration-meaning')).toHaveTextContent(
      /^Dann rechnet \S+ alle Messungen in diesem Bereich mit Maßstab 1:100\. Bisher ist er geschätzt\.$/
    )
    expect(screen.getByText('Maßstab bestätigen')).toBeInTheDocument()
    expect(screen.getByTestId('calibration-question')).toHaveTextContent(
      /^Ist die markierte Strecke 21,00\sm lang\?$/
    )
    expect(screen.getByTestId('calibration-caption')).toHaveTextContent(/ · Seite 2$/)
    expect(screen.getByTestId('proposal-footnote')).toHaveTextContent(
      'Verwerfen: Der Maßstab bleibt geschätzt.'
    )
    expect(screen.getByRole('button', { name: 'Bestätigen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument()
  })

  it('draws the span where its two points lie in the clip, which is cut around the span', async () => {
    serve(calibration())
    render(card)
    const line = await screen.findByTestId('calibration-span')

    // The span is centred in a 3:2 clip with 18 % of its length either side, tight enough to read its figure.
    const share = (attribute: string) => parseFloat(line.getAttribute(attribute) ?? '')
    expect(share('x1')).toBeCloseTo((0.18 / 1.36) * 100, 1)
    expect(share('x2')).toBeCloseTo((1.18 / 1.36) * 100, 1)
    expect(share('y1')).toBeCloseTo(50, 3)
    expect(share('y2')).toBeCloseTo(50, 3)
    expect(line).toHaveAttribute('stroke', 'var(--paper-ink)')
    expect(line).toHaveAttribute('stroke-linecap', 'round')

    const ends = screen.getAllByTestId('calibration-end')
    expect(ends.map((end) => [end.getAttribute('x'), end.getAttribute('y')])).toEqual([
      [line.getAttribute('x1'), line.getAttribute('y1')],
      [line.getAttribute('x2'), line.getAttribute('y2')],
    ])
  })

  it('„Confirm“ applies the proposal once and the receipt says the scale is confirmed, by whom', async () => {
    const stored = serve(calibration())
    server.use(
      http.post(`/api/proposals/${PROPOSAL_ID}/apply`, () => {
        stored.current = calibration(decidedByAnna('applied', [{ label: SUMMARY, ok: true }]))
        return HttpResponse.json({ proposal: stored.current })
      })
    )
    const user = userEvent.setup()
    render(card)
    await screen.findByTestId('calibration-meaning')

    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(posts()).toEqual([`POST /api/proposals/${PROPOSAL_ID}/apply`]))
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent(
      /^Scale 1:100 confirmed\. Measurements in this area now count as confirmed\.$/
    )
    expect(screen.getByTestId('calibration-receipt')).toHaveTextContent(
      /^21\.00\sm · Grundriss EG\.pdf · page 2$/
    )
    expect(screen.getByTestId('proposal-decided-by')).toHaveTextContent('Applied by Anna Berger')
  })

  it('„Discard“ dismisses it and the receipt says the scale is not confirmed', async () => {
    const stored = serve(calibration())
    server.use(
      http.post(`/api/proposals/${PROPOSAL_ID}/dismiss`, () => {
        stored.current = calibration(decidedByAnna('dismissed'))
        return HttpResponse.json({ proposal: stored.current })
      })
    )
    const user = userEvent.setup()
    render(card)
    await screen.findByTestId('calibration-meaning')

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(posts()).toEqual([`POST /api/proposals/${PROPOSAL_ID}/dismiss`]))
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent(
      /^Scale not confirmed\. It stays estimated\.$/
    )
  })

  it('a failed apply keeps the frame’s failure and the route’s reason', async () => {
    serve(
      calibration(
        decidedByAnna('failed', [
          { label: SUMMARY, ok: false, reason: 'The document has no version.' },
        ])
      )
    )
    render(card)
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent(
      'Nothing could be applied'
    )
    expect(screen.getByTestId('proposal-failures')).toHaveTextContent(
      'The document has no version.'
    )
  })

  it('offers nothing to press to a reader who may not decide, and still shows the question', async () => {
    serve(calibration({ canDecide: false }))
    render(card)
    expect(await screen.findByTestId('calibration-meaning')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.getByTestId('proposal-unavailable')).toBeInTheDocument()
  })

  it('is what the chat draws for an operation proposal that sets a scale', async () => {
    serve(calibration())
    const answer = {
      type: 'operation_proposal',
      proposal_id: PROPOSAL_ID,
      title: SUMMARY,
      operation: 'drawing-calibration-set',
      input: INPUT,
    } as AnswerCard
    render(<AnswerCards cards={[answer]} projectId="proj-1" messageId="msg-1" />)
    expect(await screen.findByTestId('calibration-question')).toBeInTheDocument()
    expect(screen.queryByTestId('operation-input')).toBeNull()
  })
})

describe('a proposed calibration, clip not drawn', () => {
  it('keeps „Confirm“ waiting while the clip is not on screen yet, and states no scale', async () => {
    restore()
    restore = installLayoutObservers({ intersecting: false })
    serve(calibration())
    const user = userEvent.setup()
    render(card)

    const confirm = await screen.findByRole('button', { name: 'Confirm' })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('proposal-accept-blocked')).toHaveTextContent(
      'The clip is still loading.'
    )
    expect(screen.queryByTestId('calibration-meaning')).toBeNull()
    await user.click(confirm)
    expect(posts()).toEqual([])
  })

  it.each([
    ['denied', 'a reader who may not open the document', 404, 'Ask someone with access to confirm it.'],
    ['unavailable', 'a file that does not load', 500, 'The drawing cannot be shown right now'],
  ])(
    'refuses confirming (%s) for %s: the reason, no generic receipt, no „Confirm“',
    async (reason, _name, status, words) => {
      pdf.status = status
      serve(calibration())
      render(card)

      const refusal = await screen.findByTestId('calibration-refusal')
      expect(refusal).toHaveAttribute('data-reason', reason)
      expect(refusal).toHaveTextContent(words)
      expect(screen.queryByTestId('operation-input')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
      expect(screen.queryByTestId('proposal-accept-blocked')).toBeNull()
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    }
  )

  it('refuses up front, without opening the file, when the server names no document the reader may see', async () => {
    serve(calibration({ targets: [{ type: 'document', id: DOCUMENT_ID, name: null }] }))
    render(card)

    expect(await screen.findByTestId('calibration-refusal')).toHaveAttribute('data-reason', 'denied')
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.queryByTestId('proposal-footnote')).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    expect(pdf.opened).toEqual([])
  })

  it('stops waiting for a clip that never loads and refuses with the reason', async () => {
    pdf.hang = true
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      serve(calibration())
      render(card)
      await screen.findByTestId('proposal-accept-blocked')
      await vi.advanceTimersByTimeAsync(CLIP_TIMEOUT_MS)
      expect(await screen.findByTestId('calibration-refusal')).toHaveAttribute(
        'data-reason',
        'unavailable'
      )
    } finally {
      vi.useRealTimers()
    }
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })

  it('refuses a proposal whose input is incomplete, without opening anything', async () => {
    const { lengthM: _dropped, ...partial } = BODY
    serve(
      calibration({
        payload: {
          operation: 'drawing-calibration-set',
          input: { params: INPUT.params, body: partial },
          summary: SUMMARY,
        },
      })
    )
    render(<CalibrationReceipt proposalId={PROPOSAL_ID} input={{}} />)

    expect(await screen.findByTestId('calibration-refusal')).toHaveAttribute(
      'data-reason',
      'incomplete'
    )
    await screen.findByRole('button', { name: 'Discard' })
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(pdf.opened).toEqual([])
  })
})

describe('proposedCalibrationOf', () => {
  it('reads the document and the calibration of a call that fits the route', () => {
    expect(proposedCalibrationOf('drawing-calibration-set', INPUT)).toEqual({
      documentId: DOCUMENT_ID,
      calibration: BODY,
    })
  })

  it.each([
    ['another operation', INPUT, 'document-move'],
    ['no document id', { body: BODY }, 'drawing-calibration-set'],
    [
      'a point outside the region',
      { ...INPUT, body: { ...BODY, to: { x: 0.9, y: 0.9 } } },
      'drawing-calibration-set',
    ],
    [
      'a length that is no number',
      { ...INPUT, body: { ...BODY, lengthM: '21' } },
      'drawing-calibration-set',
    ],
    [
      'an older shape without a region',
      { ...INPUT, body: { page: 1, from: BODY.from, to: BODY.to, lengthM: 21 } },
      'drawing-calibration-set',
    ],
  ])('is null for %s', (_name, input, operation) => {
    expect(proposedCalibrationOf(operation, input)).toBeNull()
  })
})
