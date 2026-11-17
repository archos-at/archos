import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const renderer = vi.fn()
vi.mock('../render-diagram', () => ({
  diagramRendererFor: () => renderer,
}))

const openFiledDocument = vi.fn()
vi.mock('@/features/documents/lib/open-filed-document', () => ({
  openFiledDocument: (...args: unknown[]) => openFiledDocument(...args),
}))

import { MermaidDiagram, likelyForm } from './mermaid-diagram'
import { DiagramFilingProvider, diagramRunId } from '../diagram-filing-context'
import { clearDiagramModelCache } from '../use-diagram-model'

const SOURCE = 'graph TD\n  A --> B'
const DRAWN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

beforeEach(() => {
  vi.clearAllMocks()
  renderer.mockResolvedValue(DRAWN)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('while the answer is still arriving', () => {
  it("holds the drawing's place and does not try to draw it", async () => {
    render(<MermaidDiagram source={SOURCE} isStreaming />)
    expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'streaming')
    expect(renderer).not.toHaveBeenCalled()
    expect(screen.queryByText(/graph TD/)).not.toBeInTheDocument()
    expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('aria-busy', 'true')
  })

  it('draws it once the answer is finished', async () => {
    const { rerender } = render(<MermaidDiagram source={SOURCE} isStreaming />)
    expect(renderer).not.toHaveBeenCalled()
    rerender(<MermaidDiagram source={SOURCE} isStreaming={false} />)
    await waitFor(() =>
      expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'drawn')
    )
  })
})

describe('the frame a fence waits in', () => {
  it('is the frame its drawing is most likely drawn in, read off the first keyword', () => {
    expect(likelyForm('flowchart LR\n  A --> B')).toBe('view')
    expect(likelyForm('%% Kommentar\nsequenceDiagram\n  A->>B: x')).toBe('view')
    expect(likelyForm('---\ntitle: Ablauf\n---\ngantt\n  title Plan')).toBe('view')
    expect(likelyForm('classDiagram\n  A <|-- B')).toBe('svg')
    expect(likelyForm('')).toBe('svg')
  })

  it('holds a fence being written on the plane its view is drawn on, not in mermaid’s hairline frame', () => {
    render(<MermaidDiagram source={'flowchart LR\n  A --> B'} isStreaming />)
    const figure = screen.getByTestId('mermaid-diagram')
    expect(figure.querySelector('.bg-muted\\/40')).not.toBeNull()
    expect(figure.querySelector('.border')).toBeNull()
  })
})

describe('while its source is being parsed', () => {
  it('holds a placeholder and claims nothing about a drawing it has not chosen yet', () => {
    clearDiagramModelCache()
    render(<MermaidDiagram source={'graph LR\n  Parse --> Pending'} />)
    const figure = screen.getByTestId('mermaid-diagram')
    expect(figure).toHaveAttribute('data-state', 'drawing')
    expect(figure).toHaveAttribute('aria-busy', 'true')
    expect(figure.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText(/no dimensions are claimed/i)).not.toBeInTheDocument()
    expect(figure.querySelector('figcaption')).toBeNull()
  })
})

describe('when the model writes broken mermaid', () => {
  it('falls back to the source rather than to an error', async () => {
    renderer.mockRejectedValue(new Error('Parse error on line 2'))
    render(<MermaidDiagram source={'graph TD\n  A -->'} />)
    await waitFor(() =>
      expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'failed')
    )
    expect(screen.getByText(/graph TD/)).toBeInTheDocument()
    expect(screen.getByText(/could not be drawn/i)).toBeInTheDocument()
  })

  it('swaps the held place for the source inside the same frame, fading the source in', async () => {
    let fail: (reason: Error) => void = () => {}
    renderer.mockReturnValue(new Promise<string>((_, reject) => (fail = reject)))
    render(<MermaidDiagram source={'graph TD\n  A -->'} />)
    const figure = await screen.findByTestId('mermaid-diagram')
    await waitFor(() => expect(renderer).toHaveBeenCalled())
    const frame = figure.parentElement!.parentElement!

    fail(new Error('Parse error on line 2'))
    const fallback = await waitFor(
      () => {
        const failedState = frame.querySelector<HTMLElement>('[data-state="failed"]')
        expect(failedState).toBeInTheDocument()
        return failedState!
      },
      { interval: 5 }
    )
    expect(Number(fallback.parentElement!.style.opacity)).toBeLessThan(1)
    expect(frame.querySelector('[data-state="drawing"]')).toBeInTheDocument()
    expect(fallback.closest('.flow-root')).toBe(frame)
    await waitFor(() =>
      expect(frame.querySelector('[data-state="drawing"]')).not.toBeInTheDocument()
    )
  })

  it('does not throw out of the component', async () => {
    renderer.mockRejectedValue(new Error('boom'))
    expect(() => render(<MermaidDiagram source={SOURCE} />)).not.toThrow()
    await waitFor(() =>
      expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'failed')
    )
  })
})

describe('when it draws', () => {
  it('shows the drawing and says it claims no dimensions', async () => {
    render(<MermaidDiagram source={SOURCE} />)
    await waitFor(
      () => expect(screen.getByTestId('mermaid-diagram')).toHaveAttribute('data-state', 'drawn'),
      { timeout: 8000 }
    )
    expect(screen.getByText(/no dimensions are claimed/i)).toBeInTheDocument()
    const figure = screen.getByTestId('mermaid-diagram')
    expect(figure.hasAttribute('data-view') || figure.querySelector('svg') !== null).toBe(true)
  })

  it('offers no filing action outside a project', async () => {
    render(<MermaidDiagram source={SOURCE} />)
    await waitFor(() => expect(screen.getByText(/no dimensions are claimed/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /file in project/i })).toBeNull()
  })

  it('files the bytes on screen, under the diagram’s own run id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ svg: { documentId: 'doc-1' }, pdf: { documentId: 'doc-2' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DiagramFilingProvider target={{ projectId: 'proj-1', answerId: 'msg_42' }}>
        <MermaidDiagram source={SOURCE} />
      </DiagramFilingProvider>
    )
    const button = await screen.findByRole('button', { name: /file in project/i })
    await userEvent.click(button)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/proj-1/diagrams')
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toMatchObject({
      runId: diagramRunId('msg_42', SOURCE),
      sourceKind: 'mermaid',
      source: SOURCE,
      svg: DRAWN,
    })
    expect(await screen.findByRole('link', { name: /open in project/i })).toHaveAttribute(
      'href',
      expect.stringContaining('doc-1')
    )
  })

  it('shows the server’s own refusal rather than a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'The diagram contains a script.' }),
        })
    )
    render(
      <DiagramFilingProvider target={{ projectId: 'proj-1', answerId: 'msg_42' }}>
        <MermaidDiagram source={SOURCE} />
      </DiagramFilingProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: /file in project/i }))
    expect(await screen.findByText('The diagram contains a script.')).toBeInTheDocument()
  })
})

describe('when only half of it is filed', () => {
  const partialFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ svg: { documentId: 'doc-1' }, pdf: null }),
    })

  const fileIt = async () => {
    render(
      <DiagramFilingProvider target={{ projectId: 'proj-1', answerId: 'msg_42' }}>
        <MermaidDiagram source={SOURCE} />
      </DiagramFilingProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: /file in project/i }))
  }

  it('says which half landed rather than „done" or „failed"', async () => {
    vi.stubGlobal('fetch', partialFetch())
    await fileIt()

    expect(await screen.findByText('The image was filed; the PDF was not.')).toBeInTheDocument()
    expect(screen.queryByText('Filed in the project')).toBeNull()
  })

  it('links to the half that is in the project', async () => {
    vi.stubGlobal('fetch', partialFetch())
    await fileIt()

    expect(await screen.findByRole('link', { name: /open in project/i })).toHaveAttribute(
      'href',
      expect.stringContaining('doc-1')
    )
  })

  it('offers the retry that files only the missing half', async () => {
    const fetchMock = partialFetch()
    vi.stubGlobal('fetch', fetchMock)
    await fileIt()

    const retry = await screen.findByRole('button', { name: /add the pdf/i })
    await userEvent.click(retry)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).runId).toBe(diagramRunId('msg_42', SOURCE))
  })

  it('does not call an answer it cannot read a partial filing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await fileIt()

    expect(await screen.findByText('Could not be filed')).toBeInTheDocument()
    expect(screen.queryByText('The image was filed; the PDF was not.')).toBeNull()
  })
})

describe('the diagram’s identity', () => {
  it('is stable for the same source in the same answer, so filing twice files once', () => {
    expect(diagramRunId('msg_1', SOURCE)).toBe(diagramRunId('msg_1', SOURCE))
  })

  it('differs between two diagrams in one answer, and between two answers', () => {
    expect(diagramRunId('msg_1', SOURCE)).not.toBe(diagramRunId('msg_1', 'graph LR\n  A --> B'))
    expect(diagramRunId('msg_1', SOURCE)).not.toBe(diagramRunId('msg_2', SOURCE))
  })
})

describe('filed on paper, whatever the reader is looking at', () => {
  beforeEach(() => {
    renderer.mockImplementation(({ theme }: { theme: string }) =>
      Promise.resolve(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-theme="${theme}"/>`
      )
    )
  })

  afterEach(() => {
    document.documentElement.className = ''
  })

  it('sends the paper copy while the page is dark', async () => {
    document.documentElement.classList.add('dark')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ svg: { documentId: 'doc-1' }, pdf: { documentId: 'doc-2' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DiagramFilingProvider target={{ projectId: 'proj-1', answerId: 'msg_42' }}>
        <MermaidDiagram source={SOURCE} />
      </DiagramFilingProvider>
    )
    const button = await screen.findByRole('button', { name: /file in project/i })
    await waitFor(() => expect(button).not.toBeDisabled())
    await userEvent.click(button)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.svg).toContain('data-theme="light"')
    expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-theme="dark"')
  })
})

describe('once it is in the project', () => {
  const fileIt = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ svg: { documentId: 'doc-1' }, pdf: { documentId: 'doc-2' } }),
      })
    )
    render(
      <DiagramFilingProvider target={{ projectId: 'proj-1', answerId: 'msg_42' }}>
        <MermaidDiagram source={SOURCE} />
      </DiagramFilingProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: /file in project/i }))
    return screen.findByTestId('diagram-open-filed')
  }

  it('opens the peek pane instead of leaving the thread', async () => {
    openFiledDocument.mockResolvedValue(true)
    const link = await fileIt()
    await userEvent.click(link)
    expect(openFiledDocument).toHaveBeenCalledWith({ documentId: 'doc-1', projectId: 'proj-1' })
  })

  it('still names the Files route, so a modified click and a phone both work', async () => {
    openFiledDocument.mockResolvedValue(true)
    const link = await fileIt()
    expect(link).toHaveAttribute('href', expect.stringContaining('doc-1'))
  })
})
