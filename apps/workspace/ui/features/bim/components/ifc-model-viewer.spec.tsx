import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { IfcModelViewer } from './ifc-model-viewer'
import type { IfcViewerStatus } from './ifc-viewer-canvas'
import type { BimViewerElement } from '../lib/model-index'

const canvas: { status: IfcViewerStatus | null } = { status: null }

vi.mock('./ifc-viewer-canvas', () => ({
  IfcViewerCanvas: (props: { sourceUrl: string; onStatus?: (status: IfcViewerStatus) => void }) => {
    const { onStatus } = props
    useEffect(() => {
      if (canvas.status) onStatus?.(canvas.status)
    }, [onStatus])
    return <div data-testid="ifc-canvas" data-source={props.sourceUrl} />
  },
}))

const ELEMENTS: BimViewerElement[] = [
  { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'Aussenwand', storeyName: 'Erdgeschoss' },
]

function setWebGpu(available: boolean): void {
  if (available) {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
  } else if ('gpu' in navigator) {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'gpu')
  }
}

afterEach(() => {
  setWebGpu(false)
  canvas.status = null
})

describe('IfcModelViewer without WebGPU', () => {
  it('explains what is missing and what still works, instead of a blank canvas', () => {
    setWebGpu(false)
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)

    expect(screen.getByText('3D view not available in this browser')).toBeInTheDocument()
    expect(
      screen.getByText(/a browser limitation, not a problem with the model/)
    ).toBeInTheDocument()
  })

  it('never mounts the viewport, so the WASM chunk is never fetched', () => {
    setWebGpu(false)
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
  })
})

describe('IfcModelViewer with WebGPU', () => {
  it('says it is loading while the source URL is being minted, not that the browser cannot', () => {
    setWebGpu(true)
    render(<IfcModelViewer sourceUrl={null} elements={ELEMENTS} />)
    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
    expect(
      screen.queryByText('3D view not available in this browser')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Loading model…')).toBeInTheDocument()
  })

  it('mounts the viewport once there is something to draw', async () => {
    setWebGpu(true)
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    expect(await screen.findByTestId('ifc-canvas')).toHaveAttribute(
      'data-source',
      'https://example.test/model.ifc'
    )
  })

  it('renders a legend entry per highlight group, with its resolved count', () => {
    setWebGpu(true)
    render(
      <IfcModelViewer
        sourceUrl="https://example.test/model.ifc"
        elements={ELEMENTS}
        highlights={[
          { globalIds: ['g-w1', 'g-missing'], label: 'Fluchtweg > 40 m', status: 'fail' },
        ]}
      />
    )
    expect(screen.getByText('Fluchtweg > 40 m')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('gives a new source its own chance, rather than staying broken', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'error', percent: null, meshCount: 0, message: 'Failed to get GPU adapter' }
    const { rerender } = render(
      <IfcModelViewer sourceUrl="https://example.test/a.ifc" elements={ELEMENTS} />
    )
    expect(await screen.findByText('The 3D view could not be loaded')).toBeInTheDocument()

    canvas.status = null
    rerender(<IfcModelViewer sourceUrl="https://example.test/b.ifc" elements={ELEMENTS} />)

    expect(await screen.findByTestId('ifc-canvas')).toHaveAttribute('data-source', 'https://example.test/b.ifc')
  })

  it('keeps two groups that share a label apart', () => {
    setWebGpu(true)
    const warnings: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      warnings.push(args)
    })

    try {
      const { rerender } = render(
        <IfcModelViewer
          sourceUrl="https://example.test/model.ifc"
          elements={[
            ...ELEMENTS,
            { globalId: 'g-w2', expressId: 22, ifcType: 'IfcWall', name: 'Innenwand', storeyName: 'Erdgeschoss' },
            { globalId: 'g-w3', expressId: 23, ifcType: 'IfcWall', name: 'Trennwand', storeyName: 'Erdgeschoss' },
          ]}
          highlights={[
            { globalIds: ['g-w1'], label: 'nicht erfüllt', status: 'fail' },
            { globalIds: ['g-w2', 'g-w3'], label: 'nicht erfüllt', status: 'fail' },
          ]}
        />
      )

      expect(warnings.flat().join(' ')).not.toContain('same key')

      expect(screen.getAllByText('nicht erfüllt')).toHaveLength(2)
      expect(screen.getByText('(1)')).toBeInTheDocument()
      expect(screen.getByText('(2)')).toBeInTheDocument()

      rerender(
        <IfcModelViewer
          sourceUrl="https://example.test/model.ifc"
          elements={[
            ...ELEMENTS,
            { globalId: 'g-w2', expressId: 22, ifcType: 'IfcWall', name: 'Innenwand', storeyName: 'Erdgeschoss' },
            { globalId: 'g-w3', expressId: 23, ifcType: 'IfcWall', name: 'Trennwand', storeyName: 'Erdgeschoss' },
          ]}
          highlights={[
            { globalIds: ['g-w2', 'g-w3'], label: 'nicht erfüllt', status: 'fail' },
            { globalIds: ['g-w1'], label: 'nicht erfüllt', status: 'fail' },
          ]}
        />
      )
      const counts = screen.getAllByText(/^\(\d\)$/).map((node) => node.textContent)
      expect(counts).toEqual(['(2)', '(1)'])
    } finally {
      spy.mockRestore()
    }
  })

  it('replaces a failed viewport with an explanation, not an empty canvas', async () => {
    setWebGpu(true)
    canvas.status = {
      phase: 'error',
      percent: null,
      meshCount: 0,
      message: 'Failed to get GPU adapter',
    }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)

    expect(await screen.findByText('The 3D view could not be loaded')).toBeInTheDocument()
    expect(screen.getByText(/Only the picture is missing/)).toBeInTheDocument()
    expect(screen.getByText(/Failed to get GPU adapter/)).toBeInTheDocument()
    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
  })

  it('draws no controls at all — this is the viewport, not the stage', async () => {
    setWebGpu(true)
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    await screen.findByTestId('ifc-canvas')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('shows a real percentage while the file downloads', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'downloading', percent: 42, meshCount: 0 }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  it('claims no position while the geometry is being built', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'parsing', percent: null, meshCount: 12847 }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    const bar = await screen.findByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText(/12847|12.847/)).not.toBeInTheDocument()
  })

  it('clears the veil once the building is on screen', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'ready', percent: 100, meshCount: 19 }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    await screen.findByTestId('ifc-canvas')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

describe('IfcModelViewer — the loading veil stays in its box', () => {
  it('positions the veil against the viewer, not against the page', () => {
    setWebGpu(true)
    render(<IfcModelViewer sourceUrl={null} elements={ELEMENTS} />)
    const veil = screen.getByRole('progressbar').parentElement
    expect(veil?.className).toContain('absolute')
    const box = veil?.parentElement
    expect(box?.className).toMatch(/\brelative\b/)
    expect(box?.className).toContain('overflow-hidden')
  })
})

describe('IfcModelViewer — a way out of a bad download, and a way back', () => {
  it('names the size while a file arrives, so a weak connection can decide', async () => {
    setWebGpu(true)
    canvas.status = {
      phase: 'downloading',
      percent: 31,
      meshCount: 0,
      bytes: { loaded: 37_000_000, total: 120_000_000 },
    }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    expect(await screen.findByText('31% · 37 of 120 MB')).toBeInTheDocument()
  })

  it('cancels the download, unmounting the canvas — which is what aborts the request', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'downloading', percent: 31, meshCount: 0 }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('ifc-canvas')).not.toBeInTheDocument()
    expect(screen.getByText('Loading cancelled')).toBeInTheDocument()
    expect(screen.getByText(/nothing was saved on this device/)).toBeInTheDocument()
  })

  it('loads again from a cancel with one press', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'downloading', percent: 31, meshCount: 0 }
    render(<IfcModelViewer sourceUrl="https://example.test/model.ifc" elements={ELEMENTS} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load again' }))
    expect(await screen.findByTestId('ifc-canvas')).toBeInTheDocument()
    expect(screen.queryByText('Loading cancelled')).not.toBeInTheDocument()
  })

  it('does not carry a cancel over to the next model', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'downloading', percent: 31, meshCount: 0 }
    const { rerender } = render(
      <IfcModelViewer sourceUrl="https://example.test/a.ifc" elements={ELEMENTS} />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    rerender(<IfcModelViewer sourceUrl="https://example.test/b.ifc" elements={ELEMENTS} />)
    expect(await screen.findByTestId('ifc-canvas')).toHaveAttribute('data-source', 'https://example.test/b.ifc')
  })

  it('offers a retry on a failed load, and asks the surface for a fresh URL when it can', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'error', percent: null, meshCount: 0, message: 'download failed (403)' }
    const onRetry = vi.fn()
    render(<IfcModelViewer sourceUrl="https://example.test/a.ifc" elements={ELEMENTS} onRetry={onRetry} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries against the same source when nothing can mint a new one', async () => {
    setWebGpu(true)
    canvas.status = { phase: 'error', percent: null, meshCount: 0, message: 'network' }
    render(<IfcModelViewer sourceUrl="https://example.test/a.ifc" elements={ELEMENTS} />)
    expect(await screen.findByText('The 3D view could not be loaded')).toBeInTheDocument()
    canvas.status = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('ifc-canvas')).toBeInTheDocument()
  })
})
