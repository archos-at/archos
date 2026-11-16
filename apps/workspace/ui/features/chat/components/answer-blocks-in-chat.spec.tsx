import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { resetSourcePreviewIndexCache } from './source-preview/source-preview-index'
import type { CitationSource } from '../types'
import { resetPopoverMounts } from '@/test-utils/popover-mounts'

vi.mock('@/components/ui/popover', async (importOriginal) =>
  (await import('@/test-utils/popover-mounts')).countPopoverMounts(await importOriginal())
)

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { showTechnicalReasoning: false }
    return selector ? selector(state) : state
  }),
}))

const chatStore = vi.hoisted(() => ({ projectId: null as string | null, prefill: vi.fn() }))

vi.mock('../store', () => ({
  useChatStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      projectId: chatStore.projectId,
      currentConversation: null,
      patchConversationMessage: vi.fn(),
      setComposerPrefill: chatStore.prefill,
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
  'Die Garage braucht eine mechanische Lüftung.',
  '',
  '> „Garagen sind mechanisch zu entlüften." [1]',
  '',
  'Die Rauchableitung folgt daraus [2].',
  '',
  '## Quellen',
  `- [1] [KB] ${OIB}, p.5`,
  `- [2] [KB] ${OIB}, p.18`,
].join('\n')

const citations = [locus(5, 1, 'Garagen sind mechanisch zu entlüften.'), locus(18, 2)]

const renderAnswer = () =>
  render(<AgentResponse content={answer} messageId="m1" citations={citations} routingDecision="deep" />)

describe('a locus excerpt', () => {
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

  test('names its document and page in the margin', () => {
    const { container } = renderAnswer()
    const figure = container.querySelector('figure[data-excerpt="1"]') as HTMLElement
    expect(figure).not.toBeNull()
    const margin = within(figure.querySelector('figcaption') as HTMLElement)
    expect(margin.getByText('OIB-Richtlinie 2.1, Ausgabe Mai 2023')).toBeInTheDocument()
    expect(margin.getByText('p. 5')).toBeInTheDocument()
  })

  test('opens the cited document in the app, from the margin, in one click', async () => {
    const user = userEvent.setup()
    const { container } = renderAnswer()
    const figure = container.querySelector('figure[data-excerpt="1"]') as HTMLElement
    const open = await within(figure).findByText('Open at this passage', {}, { timeout: 5000 })
    await user.click(open)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('offers no open when the cited file is on no shelf the reader can reach', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ files: [], documents: [] })))
    const { container } = renderAnswer()
    const figure = container.querySelector('figure[data-excerpt="1"]') as HTMLElement
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(figure.querySelector('[data-citation-open]')).toBeNull()
  })
})

describe('an open row of a check in a chat answer', () => {
  const CHECK = [
    'Die Prüfung ergibt:',
    '',
    ':::check',
    '| Anforderung | Ist | Soll | Stand |',
    '|---|---|---|---|',
    '| Trittschall | 57 dB | ≥ 55 dB | erfüllt |',
    '| Rauchabzug | — | — | zu prüfen |',
    ':::',
  ].join('\n')

  test('asks about the row in its own words, through the composer', async () => {
    const user = userEvent.setup()
    render(<AgentResponse content={CHECK} messageId="m2" citations={[]} routingDecision="deep" />)
    const ask = screen.getByRole('button', { name: /Rauchabzug/ })
    await user.click(ask)
    expect(chatStore.prefill).toHaveBeenCalledTimes(1)
    expect(String(chatStore.prefill.mock.calls[0]![0])).toContain('Rauchabzug')
  })
})
