import { render, screen, waitFor } from '@/test-utils'
import { describe, expect, it, vi } from 'vitest'

const renderer = vi.fn()
vi.mock('@/features/diagrams/render-diagram', () => ({
  diagramRendererFor: () => renderer,
}))

import { MarkdownRenderer } from './MarkdownRenderer'
import { isMermaidFence } from './utils'

const DRAWN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

const DYNAMIC_IMPORT_BUDGET = { timeout: 8000 }

describe('routing a fence', () => {
  it('recognises a mermaid fence by its raw class, not by the highlighting language', () => {
    expect(isMermaidFence('language-mermaid')).toBe(true)
    expect(isMermaidFence('language-typescript')).toBe(false)
    expect(isMermaidFence(undefined)).toBe(false)
    expect(isMermaidFence('language-mermaidish')).toBe(false)
  })

  it('draws a mermaid fence', async () => {
    renderer.mockResolvedValue(DRAWN)
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A --> B\n```'} />)
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'drawn'),
      DYNAMIC_IMPORT_BUDGET
    )
  }, 15000)

  it('leaves an ordinary fence alone', async () => {
    render(<MarkdownRenderer content={'```typescript\nconst a = 1\n```'} />)
    expect(screen.queryByTestId('mermaid-diagram')).toBeNull()
    expect(screen.getByText(/const a = 1/)).toBeInTheDocument()
  })

  it('holds the place of the fence still being written, without its source', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A -->'} isStreaming />)
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'streaming'),
      DYNAMIC_IMPORT_BUDGET
    )
    expect(screen.queryByText(/graph TD/)).toBeNull()
    expect(renderer).not.toHaveBeenCalled()
  }, 15000)

  it.each([
    ['a tilde fence', 'Der Ablauf:\n\n~~~mermaid\ngraph TD\n  A -->'],
    ['a fence inside a list item', '1. Der Ablauf:\n\n   ```mermaid\n   graph TD\n     A -->'],
    ['a fence in a list item with a closed fence before it', '```js\nx\n```\n\n- Ablauf:\n  ```mermaid\n  graph TD\n    A -->'],
  ])('holds the place of %s still being written', async (_name, content) => {
    render(<MarkdownRenderer content={content} isStreaming />)
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'streaming'),
      DYNAMIC_IMPORT_BUDGET
    )
    expect(renderer).not.toHaveBeenCalled()
  }, 15000)

  it.each([
    ['a closed tilde fence', '~~~mermaid\ngraph TD\n  A --> B\n~~~'],
    ['a closed fence inside a list item', '- Ablauf:\n  ```mermaid\n  graph TD\n    A --> B\n  ```'],
  ])('draws %s that ends the text while it streams', async (_name, content) => {
    renderer.mockResolvedValue(DRAWN)
    render(<MarkdownRenderer content={content} isStreaming />)
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).not.toHaveAttribute('data-state', 'streaming'),
      DYNAMIC_IMPORT_BUDGET
    )
  }, 15000)

  it('draws a closed fence while the answer after it is still streaming', async () => {
    render(
      <MarkdownRenderer content={'```mermaid\ngraph TD\n  A --> B\n```\n\nDanach folgt noch Text'} isStreaming />
    )
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).not.toHaveAttribute('data-state', 'streaming'),
      DYNAMIC_IMPORT_BUDGET
    )
  }, 15000)
})


describe('a fence the model forgot to tag', () => {
  it('is a diagram when its first line declares one', () => {
    expect(isMermaidFence(undefined, 'flowchart TD\n  A[Brand entsteht] --> B[Baustoffe]')).toBe(true)
    expect(isMermaidFence(undefined, 'sequenceDiagram\n  BW->>BB: Einreichunterlagen')).toBe(true)
    expect(isMermaidFence('language-bash', 'graph LR\n  A --> B')).toBe(true)
  })

  it('reads past a leading %%{init}%% directive', () => {
    expect(isMermaidFence(undefined, "%%{init: {'theme':'neutral'}}%%\nflowchart LR\n  A --> B")).toBe(true)
  })

  it('leaves a real listing alone', () => {
    expect(isMermaidFence('language-typescript', 'const graph = new Graph()')).toBe(false)
    expect(isMermaidFence('language-bash', 'git graph --oneline')).toBe(false)
    expect(isMermaidFence(undefined, '# pie chart data\necho "graph"')).toBe(false)
    expect(isMermaidFence(undefined, '')).toBe(false)
    expect(isMermaidFence()).toBe(false)
  })

  it('still honours an explicit mermaid tag with unfamiliar content', () => {
    expect(isMermaidFence('language-mermaid', 'something mermaid 12 has that this list does not')).toBe(true)
  })

  it('draws a BARE fence whose first line declares a diagram, through the real renderer', async () => {
    renderer.mockResolvedValue(DRAWN)
    render(<MarkdownRenderer content={'```\nflowchart TD\n  A[OIB 2] --> B[Brandschutz]\n```'} />)
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'drawn'),
      DYNAMIC_IMPORT_BUDGET
    )
  }, 15000)

  it('renders a bare non-diagram fence as a code block, not as inline code', () => {
    const { container } = render(<MarkdownRenderer content={'```\necho eins\necho zwei\n```'} />)
    expect(screen.queryByTestId('mermaid-diagram')).toBeNull()
    expect(container.querySelector('code.rounded-inline.bg-muted')).toBeNull()
    expect(screen.getByText(/echo eins/)).toBeInTheDocument()
  })

  it('still renders inline code inline', () => {
    const { container } = render(<MarkdownRenderer content={'Der Befehl `task setup` reicht.'} />)
    expect(container.querySelector('code.rounded-inline.bg-muted')).toHaveTextContent('task setup')
  })
})
