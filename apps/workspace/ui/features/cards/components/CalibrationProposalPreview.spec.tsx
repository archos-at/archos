/**
 * A proposed calibration as the one question it is: the page clip with the
 * reference span on the right pixels, the question and the scale a yes sets,
 * in German and in English, „Confirm“ and „Discard“, and nothing that reads as
 * the call (no action name, no coordinates). When the clip cannot be drawn the
 * generic receipt with every input stands in, so nothing is accepted blind.
 *
 * pdf.js is a page of 1190.55 × 841.89 pt (A3 landscape) that draws nothing, so
 * the clip is the real one (`placeClip`) and the numbers can be worked out by hand.
 */
import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { server } from '@/mocks/server'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import type { ProposedChangeView } from '@/lib/proposals/types'
import { proposedCalibrationOf } from './CalibrationProposalPreview'
import { OperationReceipt } from './ProposalReceipts'
import { decidedByAnna, PROPOSAL_ID, proposalBase, requests, resetKit, serve, startRecording } from './proposal-test-kit'

const pdf = vi.hoisted(() => ({ opened: [] as string[], status: null as number | null }))

vi.mock('@/features/knowledge/lib/pdfjs-runtime', () => ({
  documentParameters: (url: string) => ({ url }),
  loadPdfjs: async () => ({
    getDocument: ({ url }: { url: string }) => {
      pdf.opened.push(url)
      return {
        promise:
          pdf.status !== null
            ? Promise.reject(Object.assign(new Error('Unexpected server response'), { status: pdf.status }))
            : Promise.resolve({
                numPages: 3,
                getPage: async () => ({
                  getViewport: ({ scale }: { scale: number }) => ({ width: 1190.55 * scale, height: 841.89 * scale }),
                  render: () => ({ cancel: () => {}, promise: Promise.resolve() }),
                }),
              }),
        destroy: async () => {},
      }
    },
  }),
}))

vi.mock('@/features/chat/store', () => {
  const state = { projectId: 'proj-1', currentConversation: null, conversations: [], setCardDecision: vi.fn() }
  const useChatStore = (selector: (s: typeof state) => unknown) => selector(state)
  useChatStore.getState = () => state
  return { useChatStore }
})
vi.mock('@/features/chat/hooks/use-project-facts', () => ({ invalidateProjectFacts: vi.fn(), useProjectFacts: () => null }))

type OperationProposal = Extract<ProposedChangeView, { kind: 'operation' }>

const DOCUMENT_ID = '3c2b1a0f-9e8d-4c7b-a6f5-4e3d2c1b0a9f'
// Two points half the page's width apart: 595.275 pt. At 21 m that is 1:100.
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

const card = <OperationReceipt proposalId={PROPOSAL_ID} title={SUMMARY} operation="drawing-calibration-set" input={{}} />
const posts = () => requests.filter((line) => line.startsWith('POST'))

let restore: () => void = () => undefined

beforeEach(() => {
  pdf.opened = []
  pdf.status = null
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

    expect(await screen.findByTestId('calibration-meaning')).toHaveTextContent(/^Then the scale in the marked area is 1:100\.$/)
    expect(screen.getByText('Confirm the scale')).toBeInTheDocument()
    expect(screen.getByTestId('calibration-question')).toHaveTextContent(/^Is the marked length 21\.00\sm\?$/)
    expect(screen.getByTestId('calibration-caption')).toHaveTextContent(/^Grundriss EG\.pdf · page 2$/)
    expect(pdf.opened).toEqual([`/api/documents/${DOCUMENT_ID}/file`])

    // Not the action, not what it applies to, not one input, not the server's summary, not the generic question.
    expect(screen.queryByTestId('operation-name')).toBeNull()
    expect(screen.queryByTestId('operation-targets')).toBeNull()
    expect(screen.queryByTestId('operation-input')).toBeNull()
    expect(screen.queryByText(/"x"/)).toBeNull()
    expect(container).not.toHaveTextContent('drawing-calibration-set')
    expect(container).not.toHaveTextContent(SUMMARY)
    expect(container).not.toHaveTextContent('Action')
    expect(container).not.toHaveTextContent('Apply')
    expect(container).not.toHaveTextContent(/0\.\d/)
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('asks it in German, the length as German writes it', async () => {
    serve(calibration())
    render(
      <I18nProvider initialLocale="de" fixedLocale>
        {card}
      </I18nProvider>
    )
    expect(await screen.findByTestId('calibration-meaning')).toHaveTextContent(/^Dann gilt im markierten Bereich der Maßstab 1:100\.$/)
    expect(screen.getByText('Maßstab bestätigen')).toBeInTheDocument()
    expect(screen.getByTestId('calibration-question')).toHaveTextContent(/^Ist die markierte Strecke 21,00\sm lang\?$/)
    expect(screen.getByTestId('calibration-caption')).toHaveTextContent(/^Grundriss EG\.pdf · Seite 2$/)
    expect(screen.getByRole('button', { name: 'Bestätigen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument()
  })

  it('draws the span between the two points where they lie in the drawn clip', async () => {
    serve(calibration())
    render(card)
    const line = await screen.findByTestId('span-mark-line')

    // The region on the page is 714.33 × 252.57 pt at (238.11, 252.57). With
    // `placeClip`'s margin (35 % of the box each side) it is 1214.36 wide and
    // is made 3:2, so 809.57 high. That is wider than the page, so the clip is
    // the page's full width, and it starts at the top (centred it would start
    // above the page). The points, at y = 0.45 × 841.89 = 378.85 pt, are
    // therefore at 25 % and 75 % across and 378.85 / 809.57 = 46.80 % down.
    const share = (attribute: string) => parseFloat(line.getAttribute(attribute) ?? '')
    expect(line.getAttribute('x1')).toMatch(/%$/)
    expect(share('x1')).toBeCloseTo(25, 6)
    expect(share('x2')).toBeCloseTo(75, 6)
    expect(share('y1')).toBeCloseTo(46.796, 2)
    expect(share('y2')).toBeCloseTo(46.796, 2)

    // A dot at each end, on the line's ends, in the frame the page is drawn in, beside the region's own mark.
    const ends = screen.getAllByTestId('span-mark-end')
    expect(ends.map((end) => [end.getAttribute('cx'), end.getAttribute('cy')])).toEqual([
      [line.getAttribute('x1'), line.getAttribute('y1')],
      [line.getAttribute('x2'), line.getAttribute('y2')],
    ])
    const sheet = line.closest('[data-slot="page-sheet"]')
    expect(sheet?.querySelector('[data-testid="region-mark"]')).not.toBeNull()
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
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent(/^Scale confirmed\.$/)
    expect(screen.getByTestId('proposal-decided-by')).toHaveTextContent('Applied by Anna Berger')
    await waitFor(() => expect(screen.queryByTestId('calibration-preview')).toBeNull())
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
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent(/^Scale not confirmed\.$/)
  })

  it('a failed apply keeps the frame’s failure and the route’s reason', async () => {
    serve(calibration(decidedByAnna('failed', [{ label: SUMMARY, ok: false, reason: 'The document has no version.' }])))
    render(card)
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent('Nothing could be applied')
    expect(screen.getByTestId('proposal-failures')).toHaveTextContent('The document has no version.')
  })

  it('offers nothing to press to a reader who may not decide, and still shows the question', async () => {
    serve(calibration({ canDecide: false }))
    render(card)
    expect(await screen.findByTestId('calibration-meaning')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.getByTestId('proposal-unavailable')).toBeInTheDocument()
  })
})

describe('a proposed calibration, clip not drawn', () => {
  it('keeps „Confirm“ waiting while the clip is not on screen yet, and states no scale', async () => {
    // No page comes near the screen: the thumbnail stays waiting.
    restore()
    restore = installLayoutObservers({ intersecting: false })
    serve(calibration())
    const user = userEvent.setup()
    render(card)

    const confirm = await screen.findByRole('button', { name: 'Confirm' })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('proposal-accept-blocked')).toHaveTextContent('The clip is still loading.')
    expect(screen.queryByTestId('calibration-meaning')).toBeNull()
    await user.click(confirm)
    expect(posts()).toEqual([])
  })

  it.each([
    ['a reader who may not open the document', 404],
    ['a file that does not load', 500],
  ])('falls back to the generic receipt with every input for %s', async (_name, status) => {
    pdf.status = status
    const stored = serve(calibration())
    server.use(
      http.post(`/api/proposals/${PROPOSAL_ID}/apply`, () => {
        stored.current = calibration(decidedByAnna('applied', [{ label: SUMMARY, ok: true }]))
        return HttpResponse.json({ proposal: stored.current })
      })
    )
    const user = userEvent.setup()
    render(card)

    // The generic body: the action, what it applies to, the server's summary and each field of the call.
    const input = await screen.findByTestId('operation-input')
    expect(screen.queryByTestId('calibration-preview')).toBeNull()
    expect(screen.queryByText('Confirm the scale')).toBeNull()
    expect(screen.getByText(SUMMARY)).toBeInTheDocument()
    expect(screen.getByTestId('operation-name')).toHaveTextContent('drawing-calibration-set')
    expect(screen.getByTestId('operation-targets')).toHaveTextContent('Document Grundriss EG.pdf')
    for (const shown of ['Page2', 'Region{"x": 0.2, "y": 0.3, "w": 0.6, "h": 0.3}', 'From{"x": 0.25, "y": 0.45}', 'To{"x": 0.75, "y": 0.45}', 'Length (m)21']) {
      expect(input).toHaveTextContent(shown)
    }
    // The generic receipt's own gate decides: these values are short and shown whole, so nothing waits (`operation-input.spec.ts`).
    expect(screen.queryByTestId('proposal-accept-blocked')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(posts()).toEqual([`POST /api/proposals/${PROPOSAL_ID}/apply`]))
    // Decided, it is still a scale that was confirmed.
    expect(await screen.findByTestId('proposal-status')).toHaveTextContent(/^Scale confirmed\.$/)
  })
})

describe('proposedCalibrationOf', () => {
  it('reads the document and the calibration of a call that fits the route', () => {
    expect(proposedCalibrationOf('drawing-calibration-set', INPUT)).toEqual({ documentId: DOCUMENT_ID, calibration: BODY })
  })

  it.each([
    ['another operation', INPUT, 'document-move'],
    ['no document id', { body: BODY }, 'drawing-calibration-set'],
    ['a point outside the region', { ...INPUT, body: { ...BODY, to: { x: 0.9, y: 0.9 } } }, 'drawing-calibration-set'],
    ['a length that is no number', { ...INPUT, body: { ...BODY, lengthM: '21' } }, 'drawing-calibration-set'],
    ['an older shape without a region', { ...INPUT, body: { page: 1, from: BODY.from, to: BODY.to, lengthM: 21 } }, 'drawing-calibration-set'],
  ])('is null for %s', (_name, input, operation) => {
    expect(proposedCalibrationOf(operation, input)).toBeNull()
  })
})
