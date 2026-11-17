import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { IfcViewerCard } from './IfcViewerCard'

vi.mock('@/features/bim/components/ifc-model-viewer', () => ({
  IfcModelViewer: ({ onRetry }: { onRetry?: () => void }) => (
    <button type="button" data-testid="ifc-viewport" onClick={onRetry} />
  ),
}))

const MODELS = {
  models: [
    {
      id: 'model-1',
      documentId: 'doc-1',
      projectId: 'p1',
      filename: 'haus-a.ifc',
      status: 'ready',
      schemaVersion: 'IFC4',
      elementCount: 3,
      errorMessage: null,
      summary: null,
      updatedAt: '2026-02-11T09:00:00.000Z',
    },
  ],
}

const ELEMENTS = {
  elements: [
    { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'Aussenwand', storeyName: 'EG' },
    { globalId: 'g-w2', expressId: 22, ifcType: 'IfcWall', name: 'Innenwand', storeyName: 'EG' },
  ],
  total: 2,
}

function stubFetch(routes: {
  models?: unknown | 'fail' | 'never'
  query?: unknown
  source?: unknown
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/query')) {
        return routes.query === undefined
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => routes.query }
      }
      if (url.includes('/source')) {
        return routes.source === undefined
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => routes.source }
      }
      if (url.includes('/bim/models')) {
        if (routes.models === 'never') return new Promise(() => {})
        if (routes.models === 'fail' || routes.models === undefined) {
          return { ok: false, status: 500, json: async () => ({}) }
        }
        return { ok: true, json: async () => routes.models }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  )
}

beforeEach(() => {
  Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if ('gpu' in navigator) Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'gpu')
})

let nextProject = 0
const card = (props: Partial<React.ComponentProps<typeof IfcViewerCard>> = {}) =>
  render(
    <IfcViewerCard
      title="Aussenwände"
      modelFile="haus-a.ifc"
      storey={null}
      note={null}
      highlights={[]}
      projectId={`p${(nextProject += 1)}`}
      {...props}
    />
  )

describe('IfcViewerCard — which of three situations it is in', () => {
  it('does not claim the model is missing while the list is still loading', async () => {
    stubFetch({ models: 'never' })
    card()
    expect(screen.queryByText(/not available in this project/i)).not.toBeInTheDocument()
  })

  it('says the list could not be read, rather than that the model is gone', async () => {
    stubFetch({ models: 'fail' })
    card()
    await waitFor(() =>
      expect(screen.getByText(/models for this project are temporarily unavailable/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/not available in this project/i)).not.toBeInTheDocument()
  })

  it('says the model is missing when the project genuinely does not have it', async () => {
    stubFetch({ models: { models: [] } })
    card()
    await waitFor(() =>
      expect(screen.getByText(/not available in this project/i)).toBeInTheDocument()
    )
  })

  it('says a name matched several models, rather than that none of them exist', async () => {
    stubFetch({
      models: {
        models: [
          MODELS.models[0],
          { ...MODELS.models[0], id: 'model-2', documentId: 'doc-2', filename: 'haus-a-alt.ifc' },
        ],
      },
    })
    card({ modelFile: 'haus-a' })
    await waitFor(() =>
      expect(screen.getByText(/Several models in this project match that name/)).toBeInTheDocument()
    )
    expect(screen.queryByText(/not available in this project/i)).not.toBeInTheDocument()
  })

  it('says a model is still being read, rather than that it is not here', async () => {
    stubFetch({
      models: { models: [{ ...MODELS.models[0], status: 'extracting' }] },
    })
    card()
    await waitFor(() =>
      expect(screen.getByText(/still reading this model/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/not available in this project/i)).not.toBeInTheDocument()
  })

  it('says a model could not be read, which is the one the reader can fix', async () => {
    stubFetch({ models: { models: [{ ...MODELS.models[0], status: 'failed' }] } })
    card()
    await waitFor(() =>
      expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/not available in this project/i)).not.toBeInTheDocument()
  })

  it('draws the building once the model resolves', async () => {
    stubFetch({ models: MODELS, query: ELEMENTS, source: { url: 'https://example.test/m.ifc' } })
    card()
    expect(await screen.findByTestId('ifc-viewport')).toBeInTheDocument()
  })

  it('asks for a fresh model URL when the viewport retries a failed load', async () => {
    stubFetch({ models: MODELS, query: ELEMENTS, source: { url: 'https://example.test/m.ifc' } })
    card()
    const viewport = await screen.findByTestId('ifc-viewport')
    const sourceRequests = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/source')).length
    expect(sourceRequests()).toBe(1)

    viewport.click()

    await waitFor(() => expect(sourceRequests()).toBe(2))
  })
})

describe('IfcViewerCard — what it says about the answer it illustrates', () => {
  it('reports highlighted ids the model does not contain', async () => {
    stubFetch({ models: MODELS, query: ELEMENTS, source: { url: 'https://example.test/m.ifc' } })
    card({ highlights: [{ globalIds: ['g-w1', 'g-nope'], label: 'Aussenwände', status: 'fail' }] })
    await waitFor(() =>
      expect(
        screen.getByText('One of the highlighted elements is not in this model.')
      ).toBeInTheDocument()
    )
  })

  it('says nothing about missing ids while the element rows are in flight', async () => {
    stubFetch({ models: MODELS, source: { url: 'https://example.test/m.ifc' } })
    card({ highlights: [{ globalIds: ['g-w1'], label: 'Aussenwände', status: 'fail' }] })
    expect(screen.queryByText(/not in this model/)).not.toBeInTheDocument()
  })

  it('does not sit on a progress bar that can never finish', async () => {
    stubFetch({ models: MODELS, query: ELEMENTS })
    card()
    await waitFor(() =>
      expect(screen.getByText(/3D preview could not be loaded/i)).toBeInTheDocument()
    )
    expect(screen.queryByText('Loading model…')).not.toBeInTheDocument()
  })

  it('says the highlighted set could not be resolved, rather than colouring nothing', async () => {
    stubFetch({ models: MODELS, source: { url: 'https://example.test/m.ifc' } })
    card({ highlights: [{ globalIds: ['g-w1'], label: 'Aussenwände', status: 'fail' }] })
    await waitFor(() =>
      expect(screen.getByText(/element list could not be loaded/i)).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText('(0)')).not.toBeInTheDocument()
  })

  it('opens the model at the same view it is showing', async () => {
    stubFetch({ models: MODELS, query: ELEMENTS, source: { url: 'https://example.test/m.ifc' } })
    card({
      storey: 'EG',
      highlights: [{ globalIds: ['g-w1'], label: 'Aussenwände', status: 'fail' }],
    })
    const link = await screen.findByRole('link', { name: /open model/i })
    const href = link.getAttribute('href') ?? ''
    expect(href).toContain('model=haus-a.ifc')
    expect(href).toContain('storey=EG')
    expect(href).toContain('xray=1')
  })
})
