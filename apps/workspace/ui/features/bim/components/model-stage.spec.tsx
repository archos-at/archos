import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BimModelHeaderView } from '../hooks/use-bim-model'
import { buildModelQuery, type BimModelView } from '../lib/model-link'
import { ModelStage } from './model-stage'
import { PRODUCT_NAME } from '@/lib/brand'

const routerReplace = vi.fn()
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
    lastCanvasProps = props
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

let lastCanvasProps: {
  isolatedExpressIds?: Set<number> | null
  hiddenExpressIds?: ReadonlySet<number>
} | null = null

const sourceReload = vi.fn()
const modelsReload = vi.fn()
let modelsError: string | null = null
let canvasStatus: { phase: string; percent: number | null; meshCount: number; message?: string } = {
  phase: 'ready',
  percent: 100,
  meshCount: 12,
}

const state = {
  models: [] as BimModelHeaderView[],
  elements: [] as unknown[],
  elementsLoading: false,
  detail: null as unknown,
  sourceUrl: 'https://example.test/haus-a.ifc' as string | null,
  sourceError: null as string | null,
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

function model(overrides: Partial<BimModelHeaderView> = {}): BimModelHeaderView {
  return {
    id: 'm-1',
    documentId: 'doc-1',
    projectId: 'p1',
    filename: 'Haus-A.ifc',
    displayName: null,
    status: 'ready',
    schemaVersion: 'IFC4',
    elementCount: 120,
    errorMessage: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    summary: {
      storeys: [
        { globalId: null, expressId: 1, name: 'Erdgeschoss', elevation: 0, elementCount: 80 },
        { globalId: null, expressId: 2, name: 'Obergeschoss', elevation: 3.2, elementCount: 40 },
      ],
    } as BimModelHeaderView['summary'],
    ...overrides,
  }
}

function lastQuery(): URLSearchParams {
  const href = routerReplace.mock.calls.at(-1)?.[0] as string | undefined
  return new URLSearchParams(href?.split('?')[1] ?? '')
}

function setWebGpu(available: boolean): void {
  if (available) Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
  else if ('gpu' in navigator) Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'gpu')
}

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
  lastCanvasProps = null
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

describe('ModelStage — one step back', () => {
  const applyNavigation = (): void => {
    const href = routerReplace.mock.calls.at(-1)?.[0] as string | undefined
    if (href) searchParams = new URLSearchParams(href.split('?')[1] ?? '')
  }
  const back = () => screen.getByRole('button', { name: 'Undo the last change' })

  it('offers nothing to go back to before anything has changed', () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(back()).toBeDisabled()
  })

  it('puts the view back the way it was', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Obergeschoss' }))
    expect(lastQuery().get('storey')).toBe('Obergeschoss')

    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(back())

    expect(lastQuery().get('storey')).toBeNull()
    expect(lastQuery().get('model')).toBe('Haus-A.ifc')
  })

  it('walks back one step at a time, and stops at the beginning', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const step = async (name: string) => {
      await userEvent.click(screen.getByRole('button', { name }))
      applyNavigation()
      rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    }

    await step('Obergeschoss')
    await step('Details & checks')
    expect(lastQuery().get('tab')).toBe('overview')

    await userEvent.click(back())
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('tab')).toBeNull()
    expect(lastQuery().get('storey')).toBe('Obergeschoss')

    await userEvent.click(back())
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('storey')).toBeNull()
    expect(back()).toBeDisabled()
  })

  it('does not record a step for a patch that changes nothing', async () => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&storey=Obergeschoss')
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'All storeys' }))
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('storey')).toBeNull()
    routerReplace.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'All storeys' }))
    expect(routerReplace).not.toHaveBeenCalled()

    await userEvent.click(back())
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('storey')).toBe('Obergeschoss')
    expect(back()).toBeDisabled()
  })
})

describe('ModelStage — taking back a hide or an isolate', () => {
  const applyNavigation = (): void => {
    const href = routerReplace.mock.calls.at(-1)?.[0] as string | undefined
    if (href) searchParams = new URLSearchParams(href.split('?')[1] ?? '')
  }
  const back = () => screen.getByRole('button', { name: 'Undo the last change' })
  const reset = () => screen.queryByRole('button', { name: 'Show all elements again' })
  const card = () => screen.getByRole('complementary', { name: 'AW 38' })

  beforeEach(() => {
    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w1')
    state.elements = [
      { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'AW 38', storeyName: 'Erdgeschoss' },
      { globalId: 'g-w2', expressId: 22, ifcType: 'IfcWall', name: 'IW 12', storeyName: 'Erdgeschoss' },
      { globalId: 'g-w3', expressId: 24, ifcType: 'IfcWall', name: 'AW OG', storeyName: 'Obergeschoss' },
    ]
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
      materials: [],
      classifications: [],
      properties: {},
      quantities: {},
    }
  })

  it('puts the rest of the building back after an isolate', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(back()).toBeDisabled()

    await userEvent.click(within(card()).getByRole('button', { name: 'Isolate' }))
    expect(lastCanvasProps?.isolatedExpressIds).toEqual(new Set([21]))

    await userEvent.click(back())
    expect(lastCanvasProps?.isolatedExpressIds).toBeNull()
    expect(reset()).not.toBeInTheDocument()
    expect(back()).toBeDisabled()
  })

  it('brings back one hidden element at a time, where the reset drops all of them', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(within(card()).getByRole('button', { name: 'Hide' }))
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set([21]))

    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w2')
    state.detail = { ...(state.detail as Record<string, unknown>), globalId: 'g-w2', expressId: 22, name: 'IW 12' }
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const second = screen.getByRole('complementary', { name: 'IW 12' })
    await userEvent.click(within(second).getByRole('button', { name: 'Hide' }))
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set([21, 22]))

    await userEvent.click(back())
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set([21]))

    await userEvent.click(reset() as HTMLElement)
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set())
  })

  it('peels the last thing the reader did, not the last thing in the URL', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Obergeschoss' }))
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('storey')).toBe('Obergeschoss')

    await userEvent.click(within(card()).getByRole('button', { name: 'Hide' }))
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set([21]))

    await userEvent.click(back())
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set())
    expect(lastQuery().get('element')).toBe('g-w1')
    expect(lastQuery().get('storey')).toBe('Obergeschoss')

    await userEvent.click(back())
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('storey')).toBeNull()
    expect(back()).toBeDisabled()
  })

  it('gives the building back when the same element is isolated twice', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const isolate = () => within(card()).getByRole('button', { name: 'Isolate' })

    await userEvent.click(isolate())
    expect(lastCanvasProps?.isolatedExpressIds).toEqual(new Set([21]))
    expect(isolate()).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(isolate())
    expect(lastCanvasProps?.isolatedExpressIds).toBeNull()
    expect(isolate()).toHaveAttribute('aria-pressed', 'false')
    expect(reset()).not.toBeInTheDocument()
  })

  it('leaves hidden elements hidden when an isolate is toggled off', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(within(card()).getByRole('button', { name: 'Hide' }))
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set([21]))

    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w2')
    state.detail = { ...(state.detail as Record<string, unknown>), globalId: 'g-w2', expressId: 22, name: 'IW 12' }
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const second = () => screen.getByRole('complementary', { name: 'IW 12' })
    await userEvent.click(within(second()).getByRole('button', { name: 'Isolate' }))
    await userEvent.click(within(second()).getByRole('button', { name: 'Isolate' }))

    expect(lastCanvasProps?.isolatedExpressIds).toBeNull()
    expect(lastCanvasProps?.hiddenExpressIds).toEqual(new Set([21]))
  })

  it('walks back through both halves of an isolate toggled off', async () => {
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const isolate = () => within(card()).getByRole('button', { name: 'Isolate' })
    await userEvent.click(isolate())
    await userEvent.click(isolate())

    await userEvent.click(back())
    expect(lastCanvasProps?.isolatedExpressIds).toEqual(new Set([21]))

    await userEvent.click(back())
    expect(lastCanvasProps?.isolatedExpressIds).toBeNull()
    expect(back()).toBeDisabled()
  })

  it('replaces the isolation when a different element is isolated', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(within(card()).getByRole('button', { name: 'Isolate' }))
    expect(lastCanvasProps?.isolatedExpressIds).toEqual(new Set([21]))

    searchParams = new URLSearchParams('model=Haus-A.ifc&element=g-w2')
    state.detail = { ...(state.detail as Record<string, unknown>), globalId: 'g-w2', expressId: 22, name: 'IW 12' }
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    const second = screen.getByRole('complementary', { name: 'IW 12' })
    const isolateSecond = within(second).getByRole('button', { name: 'Isolate' })
    expect(isolateSecond).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(isolateSecond)
    expect(lastCanvasProps?.isolatedExpressIds).toEqual(new Set([22]))
  })

  it('offers neither verb for an element the reader has hidden', async () => {
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(within(card()).getByRole('button', { name: 'Hide' }))

    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(within(card()).queryByRole('button', { name: 'Isolate' })).not.toBeInTheDocument()
    expect(within(card()).queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
  })

  it('forgets visibility steps when the model changes', async () => {
    state.models = [model(), model({ id: 'm-2', filename: 'B.ifc' })]
    const { rerender } = render(<ModelStage projectId="p1" onClose={vi.fn()} />)
    await userEvent.click(within(card()).getByRole('button', { name: 'Isolate' }))

    await userEvent.click(screen.getByRole('button', { name: /^B\b/ }))
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('model')).toBe('B.ifc')

    await userEvent.click(back())
    applyNavigation()
    rerender(<ModelStage projectId="p1" onClose={vi.fn()} />)
    expect(lastQuery().get('model')).toBe('Haus-A.ifc')
    expect(back()).toBeDisabled()
  })
})

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

describe('ModelStage — the file operations on the building', () => {
  it('offers rename and delete on the model that is open', async () => {
    const user = userEvent.setup()
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    await user.click(await screen.findByTestId('stage-file-actions'))

    expect(await screen.findByRole('menuitem', { name: /download/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
  })

  it('closes the stage after the building it was showing is deleted', async () => {
    const onClose = vi.fn()
    const onModelDeleted = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <ModelStage
        projectId="p1"
        onClose={onClose}
        onModelDeleted={onModelDeleted}
      />
    )

    await user.click(await screen.findByTestId('stage-file-actions'))
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
    expect(await screen.findByText('Delete “Haus-A.ifc”?')).toBeInTheDocument()
    await user.click(await screen.findByTestId('document-delete-confirm'))

    await waitFor(() => expect(onModelDeleted).toHaveBeenCalledWith('doc-1'))
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1', { method: 'DELETE' })
    expect(onClose).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('calls a renamed building by its new name and leaves the link alone', async () => {
    state.models = [
      model({ displayName: 'Haus A – Bestand.ifc' }),
      model({ id: 'm-2', documentId: 'doc-2', filename: 'Nebengebäude.ifc' }),
    ]
    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    const rail = await screen.findByRole('region', { name: 'Models' })
    expect(within(rail).getByRole('button', { name: 'Haus A – Bestand' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Haus-A' })).not.toBeInTheDocument()
  })
})

describe('ModelStage — a model from the Büroablage', () => {
  it('deletes it through the org-scoped route, not the project one', async () => {
    state.models = [model({ projectId: null })]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<ModelStage projectId="p1" onClose={vi.fn()} />)

    await user.click(await screen.findByTestId('stage-file-actions'))
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
    await user.click(await screen.findByTestId('document-delete-confirm'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1', { method: 'DELETE' })
    )
    vi.unstubAllGlobals()
  })
})

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
