import { act, renderHook, waitFor } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLayoutStore } from '@/features/layout/store'

const renderer = vi.fn()
vi.mock('./render-diagram', () => ({
  diagramRendererFor: () => renderer,
}))

import { useRenderedDiagram } from './use-rendered-diagram'

const SOURCE = 'graph TD\n  A --> B'

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.className = ''
  renderer.mockImplementation(({ theme }: { theme: string }) => Promise.resolve(`<svg data-theme="${theme}"/>`))
})

afterEach(() => {
  document.documentElement.className = ''
  useLayoutStore.setState({ theme: 'system' })
})

describe('in the theme the reader is actually in', () => {
  it('draws on paper, and files the very same string', async () => {
    const { result } = renderHook(() => useRenderedDiagram(SOURCE))
    await waitFor(() => expect(result.current.svg).toBe('<svg data-theme="light"/>'))
    expect(result.current.fileSvg).toBe(result.current.svg)
    expect(renderer).toHaveBeenCalledTimes(1)
  })

  it('draws on charcoal when the page is dark', async () => {
    document.documentElement.classList.add('dark')
    const { result } = renderHook(() => useRenderedDiagram(SOURCE))
    await waitFor(() => expect(result.current.svg).toBe('<svg data-theme="dark"/>'))
  })

  it('files the paper copy even when the screen is dark', async () => {
    document.documentElement.classList.add('dark')
    const { result } = renderHook(() => useRenderedDiagram(SOURCE))
    await waitFor(() => expect(result.current.fileSvg).toBe('<svg data-theme="light"/>'))
    expect(result.current.svg).toBe('<svg data-theme="dark"/>')
  })
})

describe('when the reader flips the theme', () => {
  const flipToDark = (): void => {
    act(() => {
      document.documentElement.classList.add('dark')
      useLayoutStore.setState({ theme: 'dark' })
    })
  }

  it('redraws the mounted diagram instead of leaving a stale one', async () => {
    const { result } = renderHook(() => useRenderedDiagram(SOURCE))
    await waitFor(() => expect(result.current.svg).toBe('<svg data-theme="light"/>'))
    flipToDark()
    await waitFor(() => expect(result.current.svg).toBe('<svg data-theme="dark"/>'))
  })

  it('gives mermaid a fresh id each time, so two markers cannot collide', async () => {
    const { result } = renderHook(() => useRenderedDiagram(SOURCE))
    await waitFor(() => expect(result.current.svg).not.toBeNull())
    flipToDark()
    await waitFor(() => expect(renderer.mock.calls.length).toBeGreaterThan(1))
    const ids = renderer.mock.calls.map((call) => (call[0] as { id: string }).id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('when mermaid refuses the source', () => {
  it('reports a failure and holds no half-drawn bytes for the filing button', async () => {
    renderer.mockRejectedValue(new Error('Parse error on line 2'))
    const { result } = renderHook(() => useRenderedDiagram(SOURCE))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.svg).toBeNull()
    expect(result.current.fileSvg).toBeNull()
  })

  it('drops the paper copy of a drawing that is no longer drawn', async () => {
    const { result, rerender } = renderHook(({ source }) => useRenderedDiagram(source), {
      initialProps: { source: SOURCE },
    })
    await waitFor(() => expect(result.current.fileSvg).not.toBeNull())
    renderer.mockRejectedValue(new Error('Parse error on line 2'))
    rerender({ source: 'graph TD\n  A -->' })
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.fileSvg).toBeNull()
  })
})

describe('while the answer is still arriving', () => {
  it('does not draw at all', async () => {
    renderHook(() => useRenderedDiagram(SOURCE, false))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(renderer).not.toHaveBeenCalled()
  })
})
