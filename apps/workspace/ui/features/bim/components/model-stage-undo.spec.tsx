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
  lastCanvasProps = null
  setWebGpu(true)
})

afterEach(() => setWebGpu(false))

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
