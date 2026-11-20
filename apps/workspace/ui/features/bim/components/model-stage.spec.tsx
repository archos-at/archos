import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelStage } from './model-stage'
import { PRODUCT_NAME } from '@/lib/brand'
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

describe('ModelStage — what is on screen', () => {
  it('opens on the building, with no metadata anywhere', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(await screen.findByTestId('ifc-canvas')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('advanced-sheet')).not.toBeInTheDocument()
  })

  it('carries a handful of controls, not a toolbar of nine', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    for (const name of ['Fit the whole model', 'View', 'Section']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Top' })).not.toBeInTheDocument()
  })

  it('gives the camera button and the restore button different names', () => {
    state.elements = [
      { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'Wand', storeyName: 'Erdgeschoss' },
    ]
    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w1')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Fit the whole model' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Show everything/ })).not.toBeInTheDocument()
  })

  it('lists the project’s models and the building’s levels, top floor first', () => {
    state.models = [model(), model({ id: 'm-2', filename: 'Nebengebäude.ifc' })]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    const models = screen.getByRole('region', { name: 'Models' })
    expect(within(models).getByRole('button', { name: 'Haus-A' })).toBeInTheDocument()
    expect(within(models).getByRole('button', { name: 'Nebengebäude' })).toBeInTheDocument()

    const levels = screen.getByRole('region', { name: 'Storeys' })
    const rows = within(levels).getAllByRole('button')
    expect(rows.map((row) => row.getAttribute('title'))).toEqual([
      'All storeys',
      'Obergeschoss',
      'Erdgeschoss',
    ])
  })

  it('drops the model list entirely when there is only one', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'Models' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Storeys' })).toBeInTheDocument()
  })

  it('will not switch to a model that is still being read', () => {
    state.models = [model(), model({ id: 'm-2', filename: 'B.ifc', status: 'extracting' })]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^B\b/ })).toBeDisabled()
  })
})

describe('ModelStage — selection', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w1')
    state.detail = {
      globalId: 'g-w1',
      expressId: 21,
      ifcType: 'IfcWallStandardCase',
      name: 'AW 38',
      description: null,
      predefinedType: null,
      objectType: null,
      tag: null,
      typeName: null,
      storeyName: 'Erdgeschoss',
      materials: ['Stahlbeton'],
      classifications: [],
      properties: {},
      quantities: {},
    }
  })

  it('shows the card only once something is selected, and leads with the noun', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'AW 38' })
    expect(within(panel).getByText('Wall · Erdgeschoss')).toBeInTheDocument()
  })

  it('keeps the GlobalId, but folded away', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'AW 38' })
    const details = panel.querySelector('details')

    expect(details).not.toHaveAttribute('open')
    expect(within(panel).getByText('g-w1')).toBeInTheDocument()

    await userEvent.click(within(panel).getByText('Technical details'))
    expect(details).toHaveAttribute('open')
  })

  it('turns the selection into a question that names the element', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const ask = screen.getByRole('link', { name: new RegExp(String.raw`Ask ${PRODUCT_NAME} about this`) })
    expect(ask.getAttribute('href')).toContain('/app/projects/p1/chat?ask=')
    const question = decodeURIComponent(ask.getAttribute('href') ?? '').replace(/\+/g, ' ')
    expect(question).toContain('GlobalId g-w1')
  })

  it('drops the element from the URL when the card is closed', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'AW 38' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(lastQuery().has('element')).toBe(false)
  })

  it('puts focus back on the building when the card closes', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'AW 38' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(screen.getByTestId('ifc-canvas'))
  })

  it('puts focus back on the building when the selection is hidden', async () => {
    state.elements = [
      { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'AW 38', storeyName: 'Erdgeschoss' },
    ]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'AW 38' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Hide' }))
    expect(document.activeElement).toBe(screen.getByTestId('ifc-canvas'))
  })
})

describe('ModelStage — nothing to show', () => {
  it('says the project has no model rather than rendering an empty canvas', () => {
    state.models = []
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
    expect(screen.getByText('No IFC model yet')).toBeInTheDocument()
  })

  it('distinguishes "still being read" from "there is no model"', () => {
    state.models = [model({ status: 'extracting' })]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.getByText(/still being read/)).toBeInTheDocument()
  })

  it('explains a browser without WebGPU instead of showing a blank frame', () => {
    setWebGpu(false)
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
    expect(screen.getByText('3D view not available in this browser')).toBeInTheDocument()
  })
})

describe('ModelStage — getting out', () => {
  it('closes from its own control', async () => {
    const onClose = vi.fn()
    render(<ModelStage projectId="p1" onClose={onClose} />)
    await userEvent.click(screen.getByTestId('stage-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ModelStage — recovering from a failure', () => {
  it('offers a retry when the model list could not be loaded', async () => {
    state.models = []
    modelsError = 'load-failed'
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(modelsReload).toHaveBeenCalled()
  })

  it('says the view is unavailable when the URL could not be minted', async () => {
    state.sourceUrl = null
    state.sourceError = 'load-failed'
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    expect(screen.getAllByText('The 3D view could not be loaded')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(sourceReload).toHaveBeenCalled()
  })

  it('re-signs the URL when the renderer itself failed', async () => {
    canvasStatus = { phase: 'error', percent: null, meshCount: 0, message: 'device lost' }
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(sourceReload).toHaveBeenCalled()
  })
})

describe('ModelStage — the status a screen reader hears', () => {
  const announcement = () => screen.getAllByRole('status')[0].textContent
  const measurementSaid = () => screen.getAllByRole('status')[1].textContent

  it('keeps the measurement channel silent until there is a measurement', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(measurementSaid()).toBe('')
  })

  it('says when the building has arrived', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(announcement()).toBe('The model is on screen')
  })

  it('says a load is still running rather than staying silent', () => {
    canvasStatus = { phase: 'parsing', percent: null, meshCount: 3 }
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(announcement()).toBe('Putting the building together…')
  })

  it('reports a failure over any progress', () => {
    canvasStatus = { phase: 'error', percent: null, meshCount: 0, message: 'device lost' }
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(announcement()).toBe('The 3D view could not be loaded')
  })
})

describe('ModelStage — a download that goes badly', () => {
  beforeEach(() => {
    canvasStatus = { phase: 'downloading', percent: 31, meshCount: 0 }
  })

  it('can be cancelled, and loaded again', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
    expect(screen.getByText('Loading cancelled')).toBeInTheDocument()

    canvasStatus = { phase: 'ready', percent: 100, meshCount: 12 }
    await userEvent.click(screen.getByRole('button', { name: 'Load again' }))
    expect(await screen.findByTestId('ifc-canvas')).toBeInTheDocument()
  })
})
