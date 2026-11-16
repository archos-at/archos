import { render, screen, waitFor } from '@/test-utils'
import { describe, expect, it, vi } from 'vitest'

const renderer = vi.fn()
vi.mock('@/features/diagrams/render-diagram', () => ({
  diagramRendererFor: () => renderer,
}))

import { MarkdownRenderer } from './MarkdownRenderer'

const DRAWN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

describe('a mermaid fence whose component is still loading', () => {
  it('holds the drawing’s place from its first paint', async () => {
    renderer.mockResolvedValue(DRAWN)
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A --> B\n```\n\nDanach'} isStreaming />)
    expect(screen.getByTestId('mermaid-place')).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument(), { timeout: 8000 })
    expect(screen.queryByTestId('mermaid-place')).toBeNull()
  }, 15000)
})
