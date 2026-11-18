import { fireEvent, render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { resetSourcePreviewIndexCache } from './source-preview/source-preview-index'
import type { CitationSource } from '../types'
import { popoverMounts, resetPopoverMounts } from '@/test-utils/popover-mounts'
import { PRODUCT_NAME } from '@/lib/brand'

vi.mock('@/components/ui/popover', async (importOriginal) =>
  (await import('@/test-utils/popover-mounts')).countPopoverMounts(await importOriginal())
)

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { showTechnicalReasoning: false }
    return selector ? selector(state) : state
  }),
}))

const chatStore = vi.hoisted(() => ({ projectId: null as string | null }))

vi.mock('../store', () => ({
  useChatStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      projectId: chatStore.projectId,
      currentConversation: null,
      patchConversationMessage: vi.fn(),
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock('@/adapters/api', () => ({ cancelJob: vi.fn() }))

vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ accessToken: null }) }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/chat',
}))

const OIB = 'oib-rl_2.1_ausgabe_mai_2023.pdf'
const at = new Date('2026-07-28T12:00:00Z')

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data })

const defaultFetch = (input: RequestInfo | URL) => {
  const url = String(input)
  if (url === '/api/knowledge-base') {
    return Promise.resolve(
      jsonResponse({ files: [{ fileName: OIB, state: 'ingested' }] })
    )
  }
  return Promise.resolve(jsonResponse({ documents: [] }))
}

const fetchMock = vi.fn(defaultFetch)

const locus = (page: number, number: number, passage?: string): CitationSource => ({
  id: `c${number}`,
  content: passage ? `[KB] ${OIB}, p.${page}\n${passage}` : `[KB] ${OIB}, p.${page}`,
  citationKey: `${OIB}, p.${page}`,
  fileName: OIB,
  collection: 'oib_knowledge',
  title: 'OIB-Richtlinie 2.1, Ausgabe Mai 2023',
  origin: 'kb',
  kind: 'building_law',
  lane: 'building_law_oib',
  laneLabel: 'OIB-Richtlinie',
  page,
  number,
  isCited: true,
  timestamp: at,
})

const answer = [
  'Zwei Fluchtwege sind erforderlich [1], die Rauchableitung folgt daraus [2].',
  '',
  '## Quellen',
  `- [1] [KB] ${OIB}, p.5`,
  `- [2] [KB] ${OIB}, p.18`,
].join('\n')

const citations = [locus(5, 1, 'Garagen sind mechanisch zu entlüften.'), locus(18, 2)]

const renderAnswer = () =>
  render(
    <AgentResponse content={answer} messageId="m1" citations={citations} routingDecision="deep" />
  )

describe('an inline citation marker', () => {
  beforeEach(() => {
    resetSourcePreviewIndexCache()
    fetchMock.mockClear()
    fetchMock.mockImplementation(defaultFetch)
    chatStore.projectId = null
    resetPopoverMounts()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test.each([
    ['as it stops', true],
    ['read back after a reload', false],
  ])('an answer cut before its Quellen list keeps its markers as citations, %s', (_, stopped) => {
    render(
      <AgentResponse
        content="Zwei Fluchtwege sind erforderlich [1][2]."
        messageId={`m-cut-${String(stopped)}`}
        citations={citations}
        routingDecision="deep"
        stopped={stopped}
      />
    )
    expect(screen.queryByText(/\[1\]/)).toBeNull()
    expect(document.querySelectorAll('a[href*="cite-pending"]').length).toBe(0)
  })

  test('says which source it is, without moving the reader anywhere', async () => {
    const user = userEvent.setup()
    renderAnswer()

    await user.click(screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i }))

    const peek = await screen.findByRole('dialog')
    expect(within(peek).getByText('OIB-Richtlinie 2.1, Ausgabe Mai 2023')).toBeInTheDocument()
    expect(within(peek).getByText('OIB-Richtlinie')).toBeInTheDocument()
    expect(within(peek).getByText('p. 5')).toBeInTheDocument()
    expect(within(peek).getByText('Garagen sind mechanisch zu entlüften.')).toBeInTheDocument()
  })

  test('marks the chip it points at, so the reader can see where they landed', async () => {
    const user = userEvent.setup()
    const { container } = renderAnswer()

    expect(container.querySelector('[data-focused]')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Source 2: OIB-Richtlinie 2\.1/i }))

    const focused = container.querySelector('[data-focused]')
    expect(focused).not.toBeNull()
    expect(within(focused as HTMLElement).getByText(/OIB-Richtlinie 2\.1/)).toBeInTheDocument()
  })

  test('does not scroll the page to the chip, which would throw the pinned peek off screen', async () => {
    const user = userEvent.setup()
    const scroll = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      renderAnswer()
      await user.click(screen.getByRole('button', { name: /Source 2: OIB-Richtlinie 2\.1/i }))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  test('a marker for each page of one document resolves to that page', async () => {
    const user = userEvent.setup()
    renderAnswer()

    await user.click(screen.getByRole('button', { name: /Source 2: / }))
    const peek = await screen.findByRole('dialog')
    expect(within(peek).getByText('p. 18')).toBeInTheDocument()
  })

  test('hovering asks the question; the reader never has to commit to it', async () => {
    const user = userEvent.setup()
    renderAnswer()

    await user.hover(screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i }))

    const peek = await screen.findByRole('dialog')
    expect(within(peek).getByText('Garagen sind mechanisch zu entlüften.')).toBeInTheDocument()
  })

  test('a hovered peek yields when the pointer leaves; a clicked one stays', async () => {
    const user = userEvent.setup()
    renderAnswer()
    const marker = screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i })

    await user.hover(marker)
    await screen.findByRole('dialog')
    await user.unhover(marker)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(marker)
    await screen.findByRole('dialog')
    await user.unhover(marker)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('a read answer mounts no peek popover until a marker or chip is engaged', async () => {
    const user = userEvent.setup()
    renderAnswer()
    const marker = screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(popoverMounts.total).toBe(0)
    expect(marker).toHaveAttribute('aria-haspopup', 'dialog')
    expect(marker).toHaveAttribute('aria-expanded', 'false')

    await user.hover(marker)
    await screen.findByRole('dialog')
    expect(popoverMounts.total).toBe(1)
  })

  test('focus reaches the peek and stays on the marker it landed on', async () => {
    const user = userEvent.setup()
    renderAnswer()
    const marker = screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i })

    marker.focus()
    const peek = await screen.findByRole('dialog')
    expect(within(peek).getByText('p. 5')).toBeInTheDocument()
    expect(document.activeElement).toBe(marker)
    expect(marker.isConnected).toBe(true)

    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('a first tap on a marker still clicks: it pins the peek and marks the chip', async () => {
    const { container } = renderAnswer()
    const marker = screen.getByRole('button', { name: /Source 2: OIB-Richtlinie 2\.1/i })

    fireEvent.pointerDown(marker, { pointerType: 'touch' })
    expect(marker.isConnected).toBe(true)
    fireEvent.click(marker)

    const peek = await screen.findByRole('dialog')
    expect(within(peek).getByText('p. 18')).toBeInTheDocument()
    expect(container.querySelector('[data-focused]')).not.toBeNull()
  })

  test('two sources behind one claim are two markers, not literal text', async () => {
    const user = userEvent.setup()
    render(
      <AgentResponse
        content={[
          'Die Anforderungen an den Feuerwiderstand folgen der Klasse [1][2].',
          '',
          '## Quellen',
          `- [1] [KB] ${OIB}, p.5`,
          `- [2] [KB] ${OIB}, p.18`,
        ].join('\n')}
        messageId="m3"
        citations={citations}
        routingDecision="deep"
      />
    )

    expect(screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Source 2: OIB-Richtlinie 2\.1/i })).toBeInTheDocument()
    expect(screen.queryByText(/\[1\]\[2\]/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /Source 2: / }))
    expect(within(await screen.findByRole('dialog')).getByText('p. 18')).toBeInTheDocument()
  })

  test('the pill reserves no width its number does not use', () => {
    renderAnswer()

    const marker = screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i })
    expect(marker.className).toMatch(/\btabular-nums\b/)
    expect(marker.className).not.toMatch(/\b(?:min-)?w-\[/)
  })

  test('an anchor that is not a citation stays an ordinary link', () => {
    render(
      <AgentResponse
        content={'See [the section](#some-heading) below.'}
        messageId="m2"
        routingDecision="deep"
      />
    )
    const link = screen.getByRole('link', { name: 'the section' })
    expect(link).toHaveAttribute('href', '#some-heading')
  })

  describe('the open control is offered only when there is something to open', () => {
    test('offers it for a base-corpus PDF the viewer can render', async () => {
      const user = userEvent.setup()
      renderAnswer()

      await user.click(screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i }))
      const peek = await screen.findByRole('dialog')

      expect(
        await within(peek).findByText('Open at this passage', {}, { timeout: 5000 })
      ).toBeInTheDocument()
      expect(peek.querySelector('[data-citation-open]')).not.toBeNull()
    })

    test('says so instead when the cited file is in no shelf the reader can reach', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ files: [], documents: [] })))

      const user = userEvent.setup()
      renderAnswer()

      await user.click(screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i }))
      const peek = await screen.findByRole('dialog')

      expect(
        await within(peek).findByText(`No file for this source is available in ${PRODUCT_NAME}.`, {}, { timeout: 5000 })
      ).toBeInTheDocument()
      expect(peek.querySelector('[data-citation-open]')).toBeNull()
    })
  })

  describe('the link to the document\'s home shelf', () => {
    const projectFile = 'brandschutzkonzept_ausgabe_2026.pdf'
    const shelved = (shelf: 'project' | 'office_shelf'): CitationSource => ({
      id: 'c9',
      content: `[KB] ${projectFile}, p.3`,
      citationKey: `${projectFile}, p.3`,
      fileName: projectFile,
      collection: 'project_docs',
      title: 'Brandschutzkonzept',
      origin: 'kb',
      kind: 'project',
      shelf,
      page: 3,
      number: 1,
      isCited: true,
      timestamp: at,
    })
    const answerWith = (source: CitationSource) =>
      render(
        <AgentResponse
          content={[
            'Das Konzept sieht zwei Fluchtwege vor [1].',
            '',
            '## Quellen',
            `- [1] [KB] ${source.fileName}, p.3`,
          ].join('\n')}
          messageId="m4"
          citations={[source]}
          routingDecision="deep"
        />
      )

    test('a project-shelf document links to the project files', async () => {
      chatStore.projectId = 'p-42'
      const user = userEvent.setup()
      answerWith(shelved('project'))

      await user.click(screen.getByRole('button', { name: /Source 1: Brandschutzkonzept/i }))
      const peek = await screen.findByRole('dialog')

      const link = within(peek).getByRole('link', { name: 'Open in project files' })
      expect(link).toHaveAttribute('href', '/app/projects/p-42/files')
    })

    test('an archive document links to the office archive', async () => {
      const user = userEvent.setup()
      answerWith(shelved('office_shelf'))

      await user.click(screen.getByRole('button', { name: /Source 1: Brandschutzkonzept/i }))
      const peek = await screen.findByRole('dialog')

      expect(within(peek).getByRole('link', { name: 'Open in Office filing' })).toHaveAttribute(
        'href',
        '/app/office-shelf'
      )
    })

    test('a document a person replaced says so in the peek and names the current revision', async () => {
      chatStore.projectId = 'p-42'
      fetchMock.mockImplementation((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input) === '/api/documents/by-name'
            ? jsonResponse({
                documents: [
                  {
                    id: 'doc-old',
                    filename: projectFile,
                    contentType: 'application/pdf',
                    createdAt: '2026-08-01T00:00:00.000Z',
                    revision: {
                      supersededBy: { id: 'doc-new', filename: 'brandschutzkonzept_ausgabe_2026_b.pdf' },
                      supersedes: [],
                      suggestion: null,
                      changeSummary: null,
                    },
                  },
                ],
              })
            : jsonResponse({ documents: [], files: [] })
        )
      )
      const user = userEvent.setup()
      answerWith(shelved('project'))

      await user.click(screen.getByRole('button', { name: /Source 1: Brandschutzkonzept/i }))
      const peek = await screen.findByRole('dialog')

      expect(await within(peek).findByText('Older revision. Current:')).toBeInTheDocument()
      expect(
        within(peek).getByRole('button', {
          name: 'Open the current revision: brandschutzkonzept_ausgabe_2026_b.pdf',
        })
      ).toBeInTheDocument()
    })

    test('a base-corpus document offers no such link', async () => {
      const user = userEvent.setup()
      renderAnswer()

      await user.click(screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i }))
      const peek = await screen.findByRole('dialog')

      expect(peek.querySelector('[data-citation-home]')).toBeNull()
    })
  })
})

describe('a citation still being settled (ADR-0066)', () => {
  beforeEach(() => {
    resetSourcePreviewIndexCache()
    fetchMock.mockClear()
    fetchMock.mockImplementation(defaultFetch)
    chatStore.projectId = null
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('is a pending pill with the live pill’s box, so settling only changes its colour', () => {
    const { rerender } = render(
      <AgentResponse content="Zwei Fluchtwege sind erforderlich [1]" messageId="m1" isStreaming routingDecision="deep" />
    )
    const pending = document.querySelector('[data-citation-pending="1"]')
    expect(pending).not.toBeNull()
    expect(pending).toHaveAccessibleName(/Source 1/)
    expect(screen.queryByRole('button', { name: /Source 1:/ })).toBeNull()

    rerender(<AgentResponse content={answer} messageId="m1" citations={citations} routingDecision="deep" />)
    const live = screen.getByRole('button', { name: /Source 1: OIB-Richtlinie 2\.1/i })
    const box = (el: Element) =>
      el.className
        .split(/\s+/)
        .filter((c) => /^(inline-flex|items-center|rounded-(sm|control)|px-|relative|-top-|text-\[|font-|leading-|tabular-|pointer-coarse:)/.test(c))
        .sort()
    expect(box(pending as Element)).toEqual(box(live))
  })

  test('stands still: no pulse on a pill an answer may hold dozens of', () => {
    render(<AgentResponse content="Zwei Fluchtwege sind erforderlich [1]" messageId="m1" isStreaming routingDecision="deep" />)
    const pending = document.querySelector('[data-citation-pending="1"]')
    expect(pending?.className).not.toMatch(/animate-pulse/)
  })

  test('settles to the plain "[N]" when its source never came, without a new plugin list', () => {
    const { rerender } = render(
      <AgentResponse content="Zwei Fluchtwege sind erforderlich [1]" messageId="m1" isStreaming routingDecision="deep" />
    )
    rerender(<AgentResponse content="Zwei Fluchtwege sind erforderlich [1]" messageId="m1" routingDecision="deep" />)
    expect(document.querySelector('[data-citation-pending]')).toBeNull()
    expect(screen.getByText(/Zwei Fluchtwege sind erforderlich \[1\]/)).toBeInTheDocument()
  })
})
