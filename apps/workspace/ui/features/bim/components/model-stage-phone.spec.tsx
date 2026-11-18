import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('ModelStage — on a phone', () => {
  const stubScreen = (kind: 'portrait' | 'landscape'): void => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches:
          kind === 'portrait'
            ? query === '(max-width: 639px)' || query === '(pointer: coarse)'
            : query.includes('orientation: landscape') && query.includes('max-height'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
  }
  afterEach(() => vi.unstubAllGlobals())

  const withSelection = (): void => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w1')
    state.elements = [
      { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'AW 38', storeyName: 'Erdgeschoss' },
    ]
    state.detail = {
      globalId: '1kTvXnbbzCWw8lcMd1dR4o',
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
      quantities: { Qto_WallBaseQuantities: { Length: 8.4 } },
    }
  }

  it('shows six tools with their names written on them, and nothing scrolls', () => {
    stubScreen('portrait')
    const { container } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const bar = container.ownerDocument.querySelector('[data-slot="viewer-dock-bar"]')
    expect(bar).not.toBeNull()
    for (const caption of ['Fit', 'View', 'Section', 'Measure', 'Storeys', 'More']) {
      expect(within(bar as HTMLElement).getByText(caption)).toBeVisible()
    }
    expect(within(bar as HTMLElement).getAllByRole('button')).toHaveLength(6)
    expect(container.ownerDocument.querySelector('.overflow-x-auto')).toBeNull()
  })

  it('has no rail: its two lists are a sheet behind Levels', async () => {
    stubScreen('portrait')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Hide panel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Storeys' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Storeys' }))
    const sheet = screen.getByRole('complementary', { name: 'Storeys' })
    expect(within(sheet).getByRole('button', { name: 'Erdgeschoss' })).toBeVisible()
  })

  it('lowers the levels sheet once a level is chosen — the point is to look at it', async () => {
    stubScreen('portrait')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Storeys' }))
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Storeys' })).getByRole('button', { name: 'Erdgeschoss' }))
    expect(lastQuery().get('storey')).toBe('Erdgeschoss')
    expect(screen.queryByRole('complementary', { name: 'Storeys' })).not.toBeInTheDocument()
  })

  it('puts the rest behind More, each written out', async () => {
    stubScreen('portrait')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    const sheet = screen.getByRole('complementary', { name: 'More tools' })
    for (const row of ['Undo the last change', 'Save image', 'Details & checks']) {
      expect(within(sheet).getByRole('button', { name: row })).toBeInTheDocument()
    }
    expect(within(sheet).getByRole('button', { name: 'Save image' })).not.toHaveAttribute('aria-pressed')
  })

  it('opens the drawer from More and puts the sheet away', async () => {
    stubScreen('portrait')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Details & checks' }))
    expect(lastQuery().get('tab')).toBe('overview')
    expect(screen.queryByRole('complementary', { name: 'More tools' })).not.toBeInTheDocument()
  })

  it('shows a selection as a peek sheet, not a card over the building', () => {
    stubScreen('portrait')
    withSelection()
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const sheet = screen.getByRole('complementary', { name: 'AW 38' })
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect(within(sheet).getByRole('button', { name: 'Isolate' })).toBeVisible()
    expect(within(sheet).getByText('Qto_WallBaseQuantities')).not.toBeVisible()
  })

  it('opens the selection to its properties on a tap of the header', async () => {
    stubScreen('portrait')
    withSelection()
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByRole('complementary', { name: 'AW 38' })).toHaveAttribute('data-snap', 'full')
    expect(screen.getByText('Qto_WallBaseQuantities')).toBeVisible()
  })

  it('lets a tool sheet replace the selection without forgetting it', async () => {
    stubScreen('portrait')
    withSelection()
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('complementary', { name: 'AW 38' })).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('complementary', { name: 'More tools' })).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('complementary', { name: 'AW 38' })).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('peels one layer per Escape: the tool sheet, then the selection', async () => {
    stubScreen('portrait')
    withSelection()
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'More tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'AW 38' })).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('makes the long GlobalId readable and copyable instead of clipped', async () => {
    stubScreen('portrait')
    withSelection()
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
    const summary = screen.getByText('Technical details')
    await userEvent.click(summary)
    const id = screen.getByRole('button', { name: /Copy: 1kTvXnbbzCWw8lcMd1dR4o/ })
    expect(id).toHaveTextContent('1kTvXnbbzCWw8lcMd1dR4o')
  })

  it('says "tap", not "click", and does not promise an Esc key a finger does not have', async () => {
    stubScreen('portrait')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Measure' }))
    expect(screen.getByText('Tap the first point')).toBeInTheDocument()
    expect(screen.queryByText(/Esc/)).not.toBeInTheDocument()
  })

  it('moves the tools to a column and the selection to a side panel when turned sideways', () => {
    stubScreen('landscape')
    withSelection()
    const { container } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const doc = container.ownerDocument
    expect(doc.querySelector('[data-slot="viewer-dock-column"]')).not.toBeNull()
    expect(doc.querySelector('[data-slot="viewer-dock-bar"]')).toBeNull()
    const panel = screen.getByRole('complementary', { name: 'AW 38' })
    expect(panel).not.toHaveAttribute('data-snap')
    expect(panel.className).toContain('w-[min(20rem,42vw)]')
  })

  it('goes edge to edge on its side, inside the safe area, not a 24 px window', () => {
    stubScreen('landscape')
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('sm:w-full')
    expect(dialog.className).toContain('sm:rounded-none')
    expect(dialog.className).not.toContain('calc(100vw-3rem)')
  })

  it('keeps the desktop arrangement on a desktop', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const doc = document
    expect(doc.querySelector('[data-slot="viewer-dock-bar"]')).toBeNull()
    expect(doc.querySelector('[data-slot="viewer-dock-column"]')).toBeNull()
    expect(screen.getByRole('dialog').className).toContain('calc(100vw-3rem)')
  })
})
