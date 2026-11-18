import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelStage } from './model-stage'
import { model, modelsReload, routerReplace, setWebGpu, sourceReload, state } from './model-stage.fixtures'

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
