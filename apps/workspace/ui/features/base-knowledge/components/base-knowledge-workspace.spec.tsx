/**
 * Grundlagen des Büros over a fetch stub: the first visit explains what belongs
 * here, a filter asks the server for what needs attention, a selection turns
 * the control row into the bulk bar and sends one bulk call, and a member who
 * may not manage reads without a control to change anything.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BaseKnowledgeList } from '@/lib/base-knowledge/wire'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS } from '@/app/dev/_fixtures/base-knowledge'
import { countByFolder, countEntries } from '@/lib/base-knowledge/office/listing'
import { BaseKnowledgeWorkspace } from './base-knowledge-workspace'

const navigation = vi.hoisted(() => ({ push: vi.fn(), search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.push }),
  usePathname: () => '/app/base-knowledge',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const listOf = (entries = BASE_KNOWLEDGE_ENTRIES, canManage = true): BaseKnowledgeList => ({
  canManage,
  counts: countEntries(entries),
  folderCounts: countByFolder(entries),
  entries,
  nextCursor: null,
})

function stubFetch(list: BaseKnowledgeList, folders = BASE_KNOWLEDGE_FOLDERS) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, init })
      if (input.startsWith('/api/base-knowledge/folders')) return Response.json(folders)
      if (input.startsWith('/api/base-knowledge/bulk')) return Response.json({ results: [{ entryId: 'din-4109', ok: true, error: null }] })
      return Response.json(list)
    }),
  )
  return calls
}

const renderWorkspace = () =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <TooltipProvider>
        <BaseKnowledgeWorkspace />
      </TooltipProvider>
    </I18nProvider>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  navigation.push.mockReset()
  navigation.search = ''
})

describe('BaseKnowledgeWorkspace', () => {
  it('opens on an explanation of what belongs here when the office has none', async () => {
    stubFetch(listOf([]), { rootId: null, folders: [], nextCursor: null })
    renderWorkspace()
    expect(await screen.findByText('Noch keine Grundlagen hinterlegt')).toBeTruthy()
    expect(screen.getByText(/gehören hierher, nicht Projektunterlagen oder Vorlagen/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Hochladen/ }).length).toBeGreaterThan(0)
  })

  it('lists entries with what needs a person counted, and asks the server for a filter', async () => {
    const calls = stubFetch(listOf())
    renderWorkspace()
    const filters = await screen.findByTestId('base-knowledge-attention')
    expect(screen.getAllByTestId('base-knowledge-row')).toHaveLength(BASE_KNOWLEDGE_ENTRIES.length)
    await userEvent.click(within(filters).getByRole('button', { name: /Prüfung fällig/ }))
    await waitFor(() => expect(calls.some((call) => call.url.includes('attention=check_due'))).toBe(true))
  })

  it('drills into a folder as Dateien does, and keeps it in the URL', async () => {
    stubFetch(listOf())
    renderWorkspace()
    const card = await screen.findByTestId('folder-card-00000000-0000-4000-8000-000000000002')
    await userEvent.click(card.querySelector<HTMLButtonElement>('[data-attr="files-open"]')!)
    expect(navigation.push).toHaveBeenCalledWith('/app/base-knowledge?folder=00000000-0000-4000-8000-000000000002', { scroll: false })
  })

  it('asks the server for the folder in the URL, with its subfolders', async () => {
    navigation.search = 'folder=00000000-0000-4000-8000-000000000002'
    const calls = stubFetch(listOf())
    renderWorkspace()
    await screen.findAllByTestId('base-knowledge-row')
    expect(calls.some((call) => call.url.includes('folderId=00000000-0000-4000-8000-000000000002'))).toBe(true)
  })

  it('opens a standard as a page in place of the list, without a side panel', async () => {
    navigation.search = 'entry=oenorm-b-1600'
    stubFetch(listOf())
    renderWorkspace()
    expect(await screen.findByTestId('base-knowledge-entry-page')).toBeTruthy()
    expect(screen.queryByTestId('base-knowledge-table')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByTestId('base-knowledge-back'))
    expect(navigation.push).toHaveBeenCalledWith('/app/base-knowledge', { scroll: false })
  })

  it('turns a selection into one bulk call', async () => {
    const calls = stubFetch(listOf())
    renderWorkspace()
    const [first] = await screen.findAllByTestId('base-knowledge-row')
    await userEvent.click(within(first).getByRole('checkbox'))
    const bar = screen.getByTestId('data-toolbar-selection')
    expect(within(bar).getByText('1 ausgewählt')).toBeTruthy()
    await userEvent.click(within(bar).getByRole('button', { name: 'Als aktuell geprüft' }))
    await waitFor(() => {
      const bulk = calls.find((call) => call.url === '/api/base-knowledge/bulk')
      expect(JSON.parse(String(bulk?.init?.body))).toEqual({ entryIds: [BASE_KNOWLEDGE_ENTRIES[0].id], action: { type: 'check', result: 'current' } })
    })
  })

  it('offers a reader no control that changes anything', async () => {
    stubFetch(listOf(BASE_KNOWLEDGE_ENTRIES, false))
    renderWorkspace()
    await screen.findAllByTestId('base-knowledge-row')
    expect(screen.queryByTestId('base-knowledge-upload')).toBeNull()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Neuer Ordner/ })).toBeNull()
  })
})
