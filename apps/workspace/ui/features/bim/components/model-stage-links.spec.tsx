import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildModelQuery, type BimModelView } from '../lib/model-link'
import { ModelStage } from './model-stage'
import { lastQuery, model, modelsReload, routerReplace, setWebGpu, sourceReload, state } from './model-stage.fixtures'

let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (...args: unknown[]) => routerReplace(...args),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => searchParams,
}))

vi.mock('./ifc-viewer-canvas', () => ({
  IfcViewerCanvas: (props: {
    onStatus?: (status: unknown) => void
    onBounds?: (bounds: { minMetres: number; maxMetres: number } | null) => void
    isolatedExpressIds?: Set<number> | null
    hiddenExpressIds?: ReadonlySet<number>
  }) => {
    const { onStatus, onBounds } = props
    useEffect(() => {
      onBounds?.({ minMetres: -3, maxMetres: 9 })
    }, [onBounds])
    useEffect(() => {
      onStatus?.(canvasStatus)
    }, [onStatus])
    return <canvas data-testid="ifc-canvas" tabIndex={0} />
  },
}))

vi.mock('./model-advanced-sheet', () => ({
  ModelAdvancedSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="advanced-sheet" /> : null,
}))

vi.mock('./model-file-ownership', () => ({
  ModelFileOwnership: () => <div data-testid="stage-file-ownership" />,
}))

let modelsError: string | null = null
let canvasStatus: { phase: string; percent: number | null; meshCount: number; message?: string } = {
  phase: 'ready',
  percent: 100,
  meshCount: 12,
}

vi.mock('../hooks/use-bim-model', () => ({
  useProjectBimModels: () => ({
    data: state.models,
    isLoading: false,
    error: modelsError,
    reload: modelsReload,
  }),
  useDocumentBimModel: () => ({
    data: null,
    isLoading: false,
    error: null,
    reload: () => {},
  }),
  useBimElements: () => ({
    data: state.elementsLoading ? null : state.elements,
    isLoading: state.elementsLoading,
    error: null,
  }),
  useBimElementDetail: () => ({ data: state.detail, isLoading: false, error: null }),
  useBimModelSource: () => ({
    data: state.sourceUrl,
    isLoading: false,
    error: state.sourceError,
    reload: sourceReload,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams('model=Haus-A.ifc')
  state.models = [model()]
  state.elements = []
  state.elementsLoading = false
  state.detail = null
  state.sourceUrl = 'https://example.test/haus-a.ifc'
  state.sourceError = null
  modelsError = null
  canvasStatus = { phase: 'ready', percent: 100, meshCount: 12 }
  setWebGpu(true)
})

afterEach(() => setWebGpu(false))

describe('ModelStage — every control is a link', () => {
  it('puts the level filter in the URL', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Obergeschoss' }))
    expect(lastQuery().get('storey')).toBe('Obergeschoss')
  })

  it('puts see-through in the URL', async () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w1')
    state.elements = [
      { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'Wand', storeyName: 'Erdgeschoss' },
    ]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'See through' }))
    expect(lastQuery().get('xray')).toBe('1')
  })

  it('does not offer see-through when there is nothing to keep solid', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const xray = screen.getByRole('button', { name: /^See through — select an element/ })
    expect(xray).toBeDisabled()
  })

  it('puts the cut in the URL, at a metre above the level in view', async () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&storey=Obergeschoss')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Section' }))
    expect(lastQuery().get('cut')).toBe('4.2')
  })

  describe('dragging the cut, against an asynchronous router', () => {
    let applyNavigation: () => void

    beforeEach(() => {
      searchParams = new URLSearchParams('model=Haus-A.ifc&cut=4&cutup=0')
      applyNavigation = () => {
        const href = routerReplace.mock.calls.at(-1)?.[0] as string | undefined
        if (href) searchParams = new URLSearchParams(href.split('?')[1] ?? '')
      }
    })

    const slider = () => screen.getByRole('slider', { name: 'Cut at' })
    const cutValue = () => (slider() as HTMLInputElement).value

    it('follows the drag while the router has not caught up', async () => {
      render(<ModelStage projectId="p1" onClose={vi.fn()} />)
      fireEvent.change(slider(), { target: { value: '3.5' } })
      fireEvent.change(slider(), { target: { value: '2.4' } })
      fireEvent.change(slider(), { target: { value: '1.2' } })

      expect(cutValue()).toBe('1.2')
      expect(screen.getByText('1.20 m')).toBeInTheDocument()
    })

    it('does not write the link on every step of the drag', async () => {
      render(<ModelStage projectId="p1" onClose={vi.fn()} />)
      routerReplace.mockClear()
      fireEvent.change(slider(), { target: { value: '3.5' } })
      fireEvent.change(slider(), { target: { value: '2.4' } })

      expect(routerReplace).not.toHaveBeenCalled()
    })

    it('writes the link once, when the reader lets go', async () => {
      render(<ModelStage projectId="p1" onClose={vi.fn()} />)
      routerReplace.mockClear()
      fireEvent.change(slider(), { target: { value: '2.4' } })
      fireEvent.pointerUp(slider())

      expect(routerReplace).toHaveBeenCalledTimes(1)
      expect(lastQuery().get('cut')).toBe('2.4')
    })

    it('does not snap back while the link catches up', async () => {
      render(<ModelStage projectId="p1" onClose={vi.fn()} />)
      fireEvent.change(slider(), { target: { value: '2.4' } })
      fireEvent.pointerUp(slider())
      expect(cutValue()).toBe('2.4')

      applyNavigation()
      await waitFor(() => expect(cutValue()).toBe('2.4'))
    })

    it('reaches a cut below the origin, where a basement is', async () => {
      render(<ModelStage projectId="p1" onClose={vi.fn()} />)
      fireEvent.change(slider(), { target: { value: '-1.4' } })
      fireEvent.pointerUp(slider())

      expect(cutValue()).toBe('-1.4')
      expect(lastQuery().get('cut')).toBe('-1.4')

      applyNavigation()
      await waitFor(() => expect(cutValue()).toBe('-1.4'))
    })

    it('keeps the height when the direction is flipped mid-cut', async () => {
      render(<ModelStage projectId="p1" onClose={vi.fn()} />)
      fireEvent.change(slider(), { target: { value: '2.4' } })
      await userEvent.click(screen.getByRole('button', { name: 'Looking down' }))

      expect(lastQuery().get('cut')).toBe('2.4')
      expect(lastQuery().get('cutup')).toBe('1')
    })
  })

  it('switches model without carrying the previous building’s selection', async () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w1&storey=Erdgeschoss')
    state.models = [model(), model({ id: 'm-2', filename: 'B.ifc' })]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^B\b/ }))

    const query = lastQuery()
    expect(query.get('model')).toBe('B.ifc')
    expect(query.has('element')).toBe(false)
    expect(query.has('storey')).toBe(false)
  })
})

describe('ModelStage — the advanced surfaces', () => {
  it('stays shut until it is asked for', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByTestId('advanced-sheet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Details & checks' }))
    expect(screen.getByTestId('advanced-sheet')).toBeInTheDocument()
  })

  it('opens straight into the panel a link named', () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&tab=compliance')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.getByTestId('advanced-sheet')).toBeInTheDocument()
  })
})

describe('ModelStage — the drawer travels in the link', () => {
  it('writes the tab when the drawer is opened', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Details & checks' }))
    expect(lastQuery().get('tab')).toBe('overview')
  })

  it('clears the tab when the drawer is closed', async () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&tab=quantities')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Details & checks' }))
    expect(lastQuery().has('tab')).toBe(false)
  })

  it('keeps the drawer shut for a model that is still being read', async () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&tab=compliance')
    state.models = [model({ status: 'extracting' })]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(screen.queryByTestId('advanced-sheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Details & checks' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})

describe('ModelStage — when the link and the project disagree', () => {
  it('names the model it opened instead', () => {
    searchParams = new URLSearchParams('model=Haus-Z.ifc')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(
      screen.getAllByText(/This link names “Haus-Z.ifc”.*Showing “Haus-A.ifc” instead/)
    ).toHaveLength(2)
  })

  it('says nothing when the link named the model that opened', () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByText(/This link names/)).not.toBeInTheDocument()
  })

  it('still opens after a rename the link could not know about', () => {
    state.models = [model({ filename: 'Haus-A (final).ifc' })]
    searchParams = new URLSearchParams('model=Haus-A.ifc')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByText(/This link names/)).not.toBeInTheDocument()
  })
})

describe('ModelStage — the highlights a link carries', () => {
  const linkParams = (view: BimModelView): URLSearchParams =>
    new URLSearchParams(buildModelQuery(view))

  const WALLS = [
    { globalId: 'g-1', expressId: 1, ifcType: 'IfcWall', name: 'Aussenwand Nord', storeyName: 'Erdgeschoss' },
    { globalId: 'g-2', expressId: 2, ifcType: 'IfcWall', name: 'Aussenwand Süd', storeyName: 'Erdgeschoss' },
  ]

  it('labels the legend with the answer’s own words', () => {
    state.elements = WALLS
    searchParams = linkParams({
      model: 'Haus-A.ifc',
      highlights: [
        { status: 'fail', label: 'Fluchtweg > 40 m', globalIds: ['g-1'] },
        { status: 'fail', label: 'Türbreite < 80 cm', globalIds: ['g-2'] },
      ],
    })
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(screen.getByText('Fluchtweg > 40 m')).toBeInTheDocument()
    expect(screen.getByText('Türbreite < 80 cm')).toBeInTheDocument()
    expect(screen.queryByText('Error')).not.toBeInTheDocument()
  })

  it('falls back to the severity for a link written without a label', () => {
    state.elements = WALLS
    searchParams = new URLSearchParams('model=Haus-A.ifc&hl=fail:g-1')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('says how many the link could not carry', () => {
    state.elements = WALLS
    searchParams = linkParams({
      model: 'Haus-A.ifc',
      highlights: [{ status: 'fail', label: 'Aussenwände', globalIds: ['g-1', 'g-2'], total: 420 }],
    })
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(screen.getAllByText(/A link can carry 2 of the 420 highlighted elements/)).toHaveLength(2)
  })

  it('does not call a highlight missing while the rows are still in flight', () => {
    state.elements = WALLS
    state.elementsLoading = true
    searchParams = new URLSearchParams('model=Haus-A.ifc&hl=fail:g-1,g-2')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(screen.queryByText(/are not in this model/)).not.toBeInTheDocument()
    expect(screen.queryByText('(0)')).not.toBeInTheDocument()
  })

  it('does say so once the rows have landed and the ids are genuinely absent', () => {
    state.elements = WALLS
    searchParams = new URLSearchParams('model=Haus-A.ifc&hl=fail:g-1,g-nonexistent')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(
      screen.getAllByText(/One of the highlighted elements is not in this model/)
    ).toHaveLength(2)
  })
})
