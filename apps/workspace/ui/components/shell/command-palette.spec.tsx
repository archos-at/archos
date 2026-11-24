import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { render, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import { I18nProvider } from '@/i18n'
import type { SearchBody } from '@/lib/search/search-wire'
import { SEARCH_FIXTURE_RESPONSE } from '@/app/dev/_fixtures/search'
import { RECENT_OPENED_KEY } from '@/features/search/lib/recent-opened'
import { CommandPalette } from './command-palette'

const push = vi.fn()
let pathname = '/app/projects'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const PROJECT = '0b6f0c1e-3a55-4c0e-9a1d-7f2b5d0e1a01'
const CONCEPT = 'd0000000-0000-4000-8000-000000000001'

let asked: Array<{ query: string; body: SearchBody }> = []

function palette(): ReactElement {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <CommandPalette open onOpenChange={() => {}} />
    </I18nProvider>
  )
}

const field = (): HTMLElement => screen.getByPlaceholderText(/./)

describe('CommandPalette: the workspace search', () => {
  beforeEach(() => {
    asked = []
    push.mockClear()
    pathname = '/app/projects'
    window.localStorage.removeItem(RECENT_OPENED_KEY)
    server.use(
      http.post('*/api/search', async ({ request }) => {
        asked.push({ query: new URL(request.url).search, body: (await request.json()) as SearchBody })
        return HttpResponse.json(SEARCH_FIXTURE_RESPONSE)
      }),
    )
  })

  it('asks once typing pauses, for three hits of each kind without facet counts, across the office', async () => {
    render(palette())
    await userEvent.type(field(), 'Fluchtweg GK 4')
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0]).toEqual({ query: '', body: { text: 'Fluchtweg GK 4', limit: 3, facets: false } })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(asked).toHaveLength(1)
  })

  it('searches the whole office from inside a project too, and says so', async () => {
    pathname = `/app/projects/${PROJECT}/files`
    render(palette())
    expect(screen.getByTestId('palette-scope')).toHaveTextContent('im ganzen Büro')
    await userEvent.type(field(), 'EP-03')
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0].query).toBe('')
  })

  it('narrows to one kind of thing: files, chats or projects', async () => {
    render(palette())
    expect(within(screen.getByTestId('palette-kinds')).getAllByRole('radio').map((kind) => kind.textContent)).toEqual([
      'Alles',
      'Dateien',
      'Chats',
      'Projekte',
    ])
    await userEvent.type(field(), 'Fluchtweg')
    await waitFor(() => expect(asked).toHaveLength(1))
    await userEvent.click(screen.getByTestId('palette-kind-chats'))
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(asked[1].body).toEqual({ text: 'Fluchtweg', limit: 8, facets: false, kinds: ['conversation'] })
    await userEvent.click(screen.getByTestId('palette-kind-files'))
    await waitFor(() => expect(asked).toHaveLength(3))
    expect(asked[2].body).toEqual({ text: 'Fluchtweg', limit: 3, facets: false, kinds: ['document', 'annotation', 'folder'] })
  })

  it('groups the hits by kind, draws them as the search page does, and ends with all of them', async () => {
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    const documents = await screen.findByTestId('palette-group-document')
    expect(within(documents).getByText('Dokumente')).toBeInTheDocument()
    expect(SEARCH_FIXTURE_RESPONSE.sections.document!.hits.length).toBeGreaterThan(3)
    expect(within(documents).getAllByRole('option')).toHaveLength(3)
    const concept = screen.getByTestId(`palette-search-hit-document-${CONCEPT}`)
    expect(concept).toHaveTextContent('Brandschutzkonzept Wohnhaus Seestadt J7')
    expect(concept).toHaveTextContent('S. 7')
    expect(screen.getByTestId('palette-scope-line')).toHaveTextContent('In Wohnhaus Seestadt Baufeld J7')
    expect(concept).not.toHaveTextContent('Wohnhaus Seestadt Baufeld J7')
    expect(within(concept).getAllByText('Fluchtweg', { selector: 'mark' }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('palette-group-annotation')).toBeInTheDocument()
    expect(screen.getByTestId('palette-group-conversation')).toBeInTheDocument()

    const options = screen.getAllByRole('option')
    const all = screen.getByTestId('palette-workspace-search')
    expect(all).toHaveTextContent(/^Alle \d+ Treffer mit Filtern öffnen$/)
    const lastHit = options.findLastIndex((option) => option.dataset.testid?.startsWith('palette-search-hit-'))
    expect(options.indexOf(all)).toBe(lastHit + 1)
    expect(options[0]).toBe(concept)
  })

  it('holds an Enter pressed before the first answer, then opens the best hit', async () => {
    let answer: (() => void) | null = null
    server.use(
      http.post('*/api/search', async () => {
        await new Promise<void>((resolve) => {
          answer = resolve
        })
        return HttpResponse.json(SEARCH_FIXTURE_RESPONSE)
      })
    )
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    await userEvent.keyboard('{Enter}')
    expect(push).not.toHaveBeenCalled()
    await waitFor(() => expect(answer).not.toBeNull())
    answer!()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0][0]).not.toMatch(/^\/app\/search/)
  })

  it('lets an arrow key take back a held Enter', async () => {
    let answer: (() => void) | null = null
    server.use(
      http.post('*/api/search', async () => {
        await new Promise<void>((resolve) => {
          answer = resolve
        })
        return HttpResponse.json(SEARCH_FIXTURE_RESPONSE)
      })
    )
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    await userEvent.keyboard('{Enter}{ArrowDown}')
    await waitFor(() => expect(answer).not.toBeNull())
    answer!()
    await screen.findByTestId('palette-group-document')
    expect(push).not.toHaveBeenCalled()
  })

  it('holds an Enter on a refined question too, unless the reader moved to the row themselves', async () => {
    let slow = false
    let answer: (() => void) | null = null
    server.use(
      http.post('*/api/search', async () => {
        if (slow) {
          await new Promise<void>((resolve) => {
            answer = resolve
          })
        }
        return HttpResponse.json(SEARCH_FIXTURE_RESPONSE)
      })
    )
    render(palette())
    await userEvent.type(field(), 'Flucht')
    await screen.findByTestId('palette-group-document')
    slow = true
    await userEvent.type(field(), 'weg')
    await userEvent.keyboard('{Enter}')
    expect(push).not.toHaveBeenCalled()
    await waitFor(() => expect(answer).not.toBeNull())
    answer!()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  })

  it('opens the first hit on Enter, at the passage that was found', async () => {
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    const concept = await screen.findByTestId(`palette-search-hit-document-${CONCEPT}`)
    await waitFor(() => expect(concept).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(push).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^/app/projects/${PROJECT}/files\\?doc=${CONCEPT}&page=7&highlight=`)))
  })

  it('opens every hit on the search page from the last search row', async () => {
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    await screen.findByTestId('palette-group-document')
    await userEvent.click(screen.getByTestId('palette-workspace-search'))
    expect(push).toHaveBeenCalledWith('/app/search?q=Fluchtweg')
  })

  it('opens every hit on the search page with Ctrl+Enter, from whichever row the arrows are on', async () => {
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    const concept = await screen.findByTestId(`palette-search-hit-document-${CONCEPT}`)
    await waitFor(() => expect(concept).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/app/search?q=Fluchtweg')
  })

  it('says when nothing was found, and still offers the search page', async () => {
    server.use(http.post('*/api/search', () => HttpResponse.json({ ...SEARCH_FIXTURE_RESPONSE, sections: {} })))
    render(palette())
    await userEvent.type(field(), 'xyz')
    await waitFor(() => expect(screen.getByTestId('palette-search-status')).toHaveTextContent('Nichts gefunden für „xyz“'))
    expect(screen.getByTestId('palette-workspace-search')).toHaveTextContent('Suche mit Filtern öffnen')
  })

  it('says how many of each kind there are only where the rows show fewer', async () => {
    render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    const documents = await screen.findByTestId('palette-group-document')
    expect(documents).toHaveTextContent('3 von 14')
    expect(screen.getByTestId('palette-group-annotation')).not.toHaveTextContent('von')
  })

  it('offers to ask again when the search failed, and asks again on Enter', async () => {
    let calls = 0
    server.use(
      http.post('*/api/search', () => {
        calls += 1
        return calls === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(SEARCH_FIXTURE_RESPONSE)
      })
    )
    render(palette())
    await userEvent.type(field(), 'xyz')
    const retry = await screen.findByTestId('palette-search-retry')
    await waitFor(() => expect(retry).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    await screen.findByTestId('palette-group-document')
    expect(calls).toBe(2)
  })

  it('before anything is typed: nothing to choose until something was opened from here', async () => {
    render(palette())
    expect(screen.getByTestId('palette-start')).toHaveTextContent('Noch nichts geöffnet')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(asked).toHaveLength(0)
  })

  it('lists what was opened from here last, newest first, and opens it again', async () => {
    const view = render(palette())
    await userEvent.type(field(), 'Fluchtweg')
    await userEvent.click(await screen.findByTestId(`palette-search-hit-document-${CONCEPT}`))
    view.unmount()
    push.mockClear()

    render(palette())
    const recent = screen.getByTestId('palette-recent-opened')
    expect(within(recent).getByText('Zuletzt geöffnet')).toBeInTheDocument()
    const rows = within(recent).getAllByRole('option')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Brandschutzkonzept Wohnhaus Seestadt J7')
    expect(rows[0]).toHaveTextContent('Wohnhaus Seestadt Baufeld J7')
    await userEvent.click(rows[0])
    expect(push).toHaveBeenCalledWith(`/app/projects/${PROJECT}/files?doc=${CONCEPT}`)
  })

  it('holds no command: no project list, no section, no theme switch, no sign-out', async () => {
    render(palette())
    await userEvent.type(field(), 'Profil')
    await screen.findByTestId('palette-workspace-search')
    for (const command of ['Profil', 'Design umschalten', 'Abmelden', 'Neues Projekt', 'Alle Projekte']) {
      expect(screen.queryByText(command)).not.toBeInTheDocument()
    }
  })
})
