/**
 * The preview of a proposed calibration: the page clip with the reference span
 * on the right pixels, the line that says what is confirmed, in German and in
 * English, and nothing at all for an input the route's schema refuses.
 *
 * pdf.js is a page of 1000 × 700 that draws nothing, so the clip is the real
 * one (`placeClip`) and the span's ends can be worked out by hand.
 */
import { render, screen, waitFor } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { CalibrationProposalPreview, proposedCalibrationOf } from './CalibrationProposalPreview'

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
                  getViewport: ({ scale }: { scale: number }) => ({ width: 1000 * scale, height: 700 * scale }),
                  render: () => ({ cancel: () => {}, promise: Promise.resolve() }),
                }),
              }),
        destroy: async () => {},
      }
    },
  }),
}))

const DOCUMENT_ID = '3c2b1a0f-9e8d-4c7b-a6f5-4e3d2c1b0a9f'
const BODY = {
  page: 1,
  region: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 },
  from: { x: 0.25, y: 0.35 },
  to: { x: 0.55, y: 0.45 },
  lengthM: 4.25,
}
const INPUT = { params: { id: DOCUMENT_ID }, body: BODY }

let restore: () => void = () => undefined

beforeEach(() => {
  pdf.opened = []
  pdf.status = null
  restore = installLayoutObservers({ frameWidth: 600 })
})
afterEach(() => restore())

const preview = (input: Record<string, unknown> = INPUT, operation = 'drawing-calibration-set') => (
  <CalibrationProposalPreview operation={operation} input={input} />
)

describe('CalibrationProposalPreview', () => {
  it('draws the span between the two points where they lie in the drawn clip', async () => {
    render(preview())
    const line = await screen.findByTestId('span-mark-line')
    expect(pdf.opened).toEqual([`/api/documents/${DOCUMENT_ID}/file`])

    // The region on the page is 400 × 140 at (200, 210). `placeClip` adds a
    // margin of 35 % of the box (140 wide, 49 high) and widens the result to
    // 3:2: a clip of 680 × 453.33 at (60, 53.33). The points, at (250, 245) and
    // (550, 315) on the page, are therefore at these shares of the drawn frame.
    const share = (attribute: string) => parseFloat(line.getAttribute(attribute) ?? '')
    expect(line.getAttribute('x1')).toMatch(/%$/)
    expect(share('x1')).toBeCloseTo(((250 - 60) / 680) * 100, 6)
    expect(share('y1')).toBeCloseTo(((245 - (280 - 680 / 1.5 / 2)) / (680 / 1.5)) * 100, 6)
    expect(share('x2')).toBeCloseTo(((550 - 60) / 680) * 100, 6)
    expect(share('y2')).toBeCloseTo(((315 - (280 - 680 / 1.5 / 2)) / (680 / 1.5)) * 100, 6)
    // The same numbers, written out: no formula shared with the code under test.
    expect(share('x1')).toBeCloseTo(27.941, 2)
    expect(share('y1')).toBeCloseTo(42.279, 2)
    expect(share('x2')).toBeCloseTo(72.059, 2)
    expect(share('y2')).toBeCloseTo(57.721, 2)

    // A dot at each end, on the line's ends.
    const ends = screen.getAllByTestId('span-mark-end')
    expect(ends.map((end) => [end.getAttribute('cx'), end.getAttribute('cy')])).toEqual([
      [line.getAttribute('x1'), line.getAttribute('y1')],
      [line.getAttribute('x2'), line.getAttribute('y2')],
    ])
    // The span sits in the frame the page is drawn in, beside the region's own mark.
    const sheet = line.closest('[data-slot="page-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.querySelector('[data-testid="region-mark"]')).not.toBeNull()
  })

  it('says what is confirmed, in English', async () => {
    render(preview())
    await screen.findByTestId('span-mark-line')
    expect(screen.getByTestId('calibration-confirm')).toHaveTextContent(
      /^Reference length: 4\.25\sm between the two marked points, page 1$/
    )
  })

  it('says what is confirmed, in German, the number as German writes it', async () => {
    render(
      <I18nProvider initialLocale="de" fixedLocale>
        {preview()}
      </I18nProvider>
    )
    await screen.findByTestId('span-mark-line')
    expect(screen.getByTestId('calibration-confirm')).toHaveTextContent(
      /^Referenzstrecke: 4,25\sm zwischen den beiden markierten Punkten, Seite 1$/
    )
  })

  it('speaks of no marked points while there is no picture: a reader who may not open the document', async () => {
    pdf.status = 404
    render(preview())
    await waitFor(() => expect(screen.getByText('Not available to you')).toBeInTheDocument())
    expect(screen.queryByTestId('span-mark')).toBeNull()
    expect(screen.getByTestId('calibration-confirm')).toHaveTextContent(/^Reference length: 4\.25\sm, page 1$/)
  })

  it.each([
    ['another operation', INPUT, 'document-move'],
    ['no document id', { body: BODY }, 'drawing-calibration-set'],
    ['a point outside the region', { ...INPUT, body: { ...BODY, to: { x: 0.9, y: 0.9 } } }, 'drawing-calibration-set'],
    ['a length that is no number', { ...INPUT, body: { ...BODY, lengthM: '4.25' } }, 'drawing-calibration-set'],
    ['an older shape without a region', { ...INPUT, body: { page: 1, from: BODY.from, to: BODY.to, lengthM: 4.25 } }, 'drawing-calibration-set'],
  ])('draws nothing and fetches nothing for %s', async (_name, input, operation) => {
    expect(proposedCalibrationOf(operation, input)).toBeNull()
    const { container } = render(preview(input, operation))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container).toBeEmptyDOMElement()
    expect(pdf.opened).toEqual([])
  })
})
