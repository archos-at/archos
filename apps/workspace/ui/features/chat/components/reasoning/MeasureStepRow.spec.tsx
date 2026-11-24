import type { ReactElement } from 'react'
import { render as renderPlain, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { fakePdfjsRuntime, type FakePdfState } from '@/test-utils/pdfjs-fake'
import { storedSteps } from '@/test-utils/wire-v2-steps'
import { workRounds } from '../../lib/work-list'
import { ReasoningFlow } from './ReasoningFlow'
import { RoundCalls } from './WorkList'

const state = vi.hoisted((): FakePdfState => ({
  fail: false,
  pages: [{ items: [] }, { items: [] }],
  destroyed: 0,
}))
vi.mock('@/features/knowledge/lib/pdfjs-runtime', () => fakePdfjsRuntime(state))

const render = (ui: ReactElement) =>
  renderPlain(
    <I18nProvider initialLocale="de" fixedLocale>
      {ui}
    </I18nProvider>
  )

const measured = (extra: Record<string, unknown> = {}) => ({
  id: 'action:m1',
  call_id: 'm1',
  kind: 'action',
  round: 0,
  verb: 'measure',
  status: 'ok',
  query: 'drawing clearance p.2',
  target: 'Grundriss EG.pdf',
  document_id: '00000000-0000-4000-8000-0000000000c1',
  pages: '2',
  measure: {
    quantity: 'clearance',
    points: [
      [0.31, 0.54],
      [0.31, 0.57],
    ],
    value: 1.764,
    unit: 'm',
    basis: 'estimated',
    ratio: 100,
  },
  ...extra,
})

let restore: () => void = () => undefined
afterEach(() => restore())

const roundOf = (step: Record<string, unknown>) => workRounds(storedSteps([step]))[0]!

describe('a drawing_measure step', () => {
  test('says what it measured where, with the value, the clip with the span, and the scale it stands on', async () => {
    restore = installLayoutObservers({ frameWidth: 200 })
    render(<RoundCalls round={roundOf(measured())} eager />)
    const row = screen.getByTestId('work-row')
    expect(row.dataset.verb).toBe('measure')
    expect(row).toHaveTextContent('Misst Grundriss EG.pdf, S. 2')
    expect(within(row).getByTestId('work-row-result')).toHaveTextContent('1,76 m')
    const step = within(row).getByTestId('measure-step')
    expect(step).toHaveTextContent('Maßstab 1:100, geschätzt')
    await waitFor(() => expect(within(step).getByTestId('measure-shape')).toBeInTheDocument())
    expect(within(step).getByTestId('measure-label')).toHaveTextContent('1,76 m')
    expect(within(step).getByTestId('measure-shape').querySelectorAll('path')).toHaveLength(2)
  })

  test('the clip opens the drawing at the page', async () => {
    restore = installLayoutObservers({ frameWidth: 200 })
    const user = userEvent.setup()
    render(<RoundCalls round={roundOf(measured())} eager />)
    await user.click(screen.getByRole('button', { name: /Grundriss EG\.pdf, S\.\s2 öffnen/ }))
    expect(await screen.findByTestId('pdf-viewer-dialog')).toBeInTheDocument()
  })

  test('an area marks each corner', async () => {
    restore = installLayoutObservers({ frameWidth: 200 })
    const area = measured({
      measure: {
        quantity: 'area',
        points: [
          [0.5, 0.3],
          [0.6, 0.3],
          [0.6, 0.5],
          [0.5, 0.5],
        ],
        value: 12.5,
        unit: 'm2',
        basis: 'printed',
      },
    })
    render(<RoundCalls round={roundOf(area)} eager />)
    const shape = await screen.findByTestId('measure-shape')
    expect(shape.querySelector('polygon')).not.toBeNull()
    expect(shape.querySelectorAll('path')).toHaveLength(4)
    expect(screen.getByTestId('measure-step')).toHaveTextContent('aus einer Maßzahl abgelesen')
  })

  test('no number: the row says so, and there is no clip', () => {
    const empty = measured({ status: 'empty', measure: undefined })
    render(<RoundCalls round={roundOf(empty)} />)
    expect(screen.getByTestId('work-row-result')).toHaveTextContent('keine Zahl')
    expect(screen.queryByTestId('measure-step')).toBeNull()
  })

  test('without a document the person can open, only the line', () => {
    render(<RoundCalls round={roundOf(measured({ document_id: undefined }))} />)
    expect(screen.queryByTestId('measure-step')).toBeNull()
    expect(screen.getByTestId('work-row')).toHaveTextContent('1,76 m')
  })

  test('the Herleitung shows it in its round', () => {
    render(
      <ReasoningFlow
        steps={storedSteps([measured()])}
        userQuestion="Wie breit ist der Gang?"
        answerConfidence="medium"
      />
    )
    expect(screen.getAllByTestId('measure-step').length).toBeGreaterThan(0)
  })
})
