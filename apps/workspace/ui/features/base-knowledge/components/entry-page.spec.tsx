import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS, BASE_KNOWLEDGE_TERRITORIES } from '@/app/dev/_fixtures/base-knowledge'
import { capturePosthog } from '@/lib/analytics/posthog'
import { EntryPage } from './entry-page'

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const licenceStep = vi.hoisted(() => ({ ask: false }))
vi.mock('@/lib/base-knowledge/wire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/base-knowledge/wire')>()
  return {
    ...actual,
    get ASK_FOR_LICENCE() {
      return licenceStep.ask
    },
  }
})

const PROPOSAL = BASE_KNOWLEDGE_ENTRIES.find((entry) => entry.id === 'oenorm-b-1300')!
const CONFIRMED = BASE_KNOWLEDGE_ENTRIES.find((entry) => entry.id === 'oenorm-b-1600')!

function renderSheet(entry: BaseKnowledgeEntry, onChanged = vi.fn()) {
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <TooltipProvider>
        <EntryPage entry={entry} onBack={vi.fn()} onOpenEdition={vi.fn()} canManage rootId={BASE_KNOWLEDGE_FOLDERS.rootId} folders={BASE_KNOWLEDGE_FOLDERS.folders} territories={BASE_KNOWLEDGE_TERRITORIES} onChanged={onChanged} />
      </TooltipProvider>
    </I18nProvider>,
  )
  return onChanged
}

afterEach(() => {
  licenceStep.ask = false
  vi.unstubAllGlobals()
  for (const fn of Object.values(toast)) fn.mockReset()
  vi.mocked(capturePosthog).mockClear()
})

describe('EntryPage', () => {
  it('confirms a licensed proposal only with the office’s licence statement when the licence step is asked', async () => {
    licenceStep.ask = true
    const fetchMock = vi.fn(async () => Response.json({ ...PROPOSAL, status: 'confirmed' }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = renderSheet(PROPOSAL)
    const confirm = await screen.findByTestId('base-knowledge-save')
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('checkbox', { name: /Lizenz gilt für unser ganzes Büro/ }))
    await userEvent.click(confirm)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/base-knowledge/oenorm-b-1300/confirm')
    expect(JSON.parse(String(init.body))).toMatchObject({ designation: 'ÖNORM B 1300:2018', licenceAttested: true, aiProcessingAttested: false })
  })

  it('records a check on a confirmed copy in one click', async () => {
    const fetchMock = vi.fn(async () => Response.json(CONFIRMED))
    vi.stubGlobal('fetch', fetchMock)
    renderSheet(CONFIRMED)
    await userEvent.click(await screen.findByRole('button', { name: 'Ist noch aktuell' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/base-knowledge/oenorm-b-1600/checks')
    expect(JSON.parse(String(init.body))).toEqual({ result: 'current' })
  })

  it('confirms a proposal stored as licensed at once, with no licence question, while the office is not asked about licences', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ...PROPOSAL, status: 'confirmed' }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = renderSheet(PROPOSAL)
    const confirm = await screen.findByTestId('base-knowledge-save')
    expect(screen.queryByTestId('base-knowledge-licence')).toBeNull()
    expect(screen.queryByRole('radio', { name: /Frei zugänglich/ })).toBeNull()
    expect(screen.queryByText('Lizenz und KI-Verarbeitung')).toBeNull()
    await userEvent.click(confirm)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/base-knowledge/oenorm-b-1300/confirm')
  })

  it('shows a confirmed licensed copy no licence section while the office is not asked about licences, and the section when it is', async () => {
    renderSheet({ ...CONFIRMED, textUse: 'used' })
    await screen.findByTestId('base-knowledge-save')
    expect(screen.queryByTestId('base-knowledge-licence')).toBeNull()
    cleanup()
    licenceStep.ask = true
    renderSheet({ ...CONFIRMED, textUse: 'used' })
    expect(await screen.findByTestId('base-knowledge-licence')).toBeTruthy()
  })

  it('asks no check of a norm the resolver names a newer edition binding for, and says which and under what', async () => {
    const binding = { editionLabel: '2023-02-01', startsOn: '2023-02-01', via: { designation: 'OIB-RL 4', editionLabel: '2023' }, held: false, newer: true }
    renderSheet({ ...CONFIRMED, binding })
    const section = await screen.findByTestId('base-knowledge-check')
    expect(within(section).getByText('Verbindlich ist heute die Ausgabe 2023-02-01, laut OIB-RL 4 2023.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ist noch aktuell' })).toBeNull()
    expect(within(section).getByRole('button', { name: /Neuere Ausgabe hochladen/ })).toBeTruthy()
    expect(screen.getByTestId('base-knowledge-status')).toHaveAttribute('data-stand', 'newer_edition')
    expect(screen.getByTestId('base-knowledge-status').className).not.toMatch(/warning|danger|error/)
  })

  it('keeps the office’s own check where nothing binds an edition, and says it was the office that checked', async () => {
    renderSheet({ ...CONFIRMED, binding: null, freshness: { ...CONFIRMED.freshness, lastCheck: { checkedAt: '2026-10-02T09:00:00.000Z', checkedBy: 'user-1', result: 'current', note: null } } })
    const section = await screen.findByTestId('base-knowledge-check')
    expect(within(section).getByText('Vom Büro geprüft am 02.10.2026: aktuell.')).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Ist noch aktuell' })).toBeTruthy()
  })

  it('offers no licence step for a freely available copy while the office is not asked about licences', async () => {
    renderSheet({ ...CONFIRMED, textUse: 'used', values: { ...CONFIRMED.values, licenceClass: 'public_open' } })
    await screen.findByTestId('base-knowledge-save')
    expect(screen.queryByRole('button', { name: 'Ist doch gekauft' })).toBeNull()
  })

  it('marks a freely available copy as bought with the licence statement, and shows it as bought at once, when the licence step is asked', async () => {
    licenceStep.ask = true
    const PUBLIC: BaseKnowledgeEntry = { ...CONFIRMED, textUse: 'used', values: { ...CONFIRMED.values, licenceClass: 'public_open' } }
    const BOUGHT: BaseKnowledgeEntry = { ...PUBLIC, values: { ...PUBLIC.values, licenceClass: 'licensed' } }
    const fetchMock = vi.fn(async () => Response.json(BOUGHT))
    vi.stubGlobal('fetch', fetchMock)
    const page = (entry: BaseKnowledgeEntry) => (
      <I18nProvider initialLocale="de" fixedLocale>
        <TooltipProvider>
          <EntryPage entry={entry} onBack={vi.fn()} onOpenEdition={vi.fn()} canManage rootId={BASE_KNOWLEDGE_FOLDERS.rootId} folders={BASE_KNOWLEDGE_FOLDERS.folders} territories={BASE_KNOWLEDGE_TERRITORIES} onChanged={vi.fn()} />
        </TooltipProvider>
      </I18nProvider>
    )
    const { rerender } = render(page(PUBLIC))
    await userEvent.click(await screen.findByRole('button', { name: 'Ist doch gekauft' }))
    const save = screen.getByRole('button', { name: 'Als gekauft speichern' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('checkbox', { name: /Lizenz gilt für unser ganzes Büro/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /darf den Text lesen/ }))
    await userEvent.click(save)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/base-knowledge/oenorm-b-1600/licence')
    expect(JSON.parse(String(init.body))).toEqual({ licenceClass: 'licensed', licenceAttested: true, aiProcessingAttested: true })
    rerender(page(BOUGHT))
    expect(await screen.findByRole('button', { name: 'Ist doch frei verfügbar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ist doch gekauft' })).toBeNull()
  })

  it.each([
    ['complete', { removed: true, stores: { search: 'removed', objects: 'removed', caches: 'removed' } }, null],
    ['partial', { removed: false, stores: { search: 'failed', objects: 'removed', caches: 'failed' } }, 'Suchindex, Zwischenspeicher'],
  ])('closes after a %s removal and says only what is true of it', async (_, receipt, left) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(receipt)))
    const onChanged = renderSheet(CONFIRMED)
    await userEvent.click(await screen.findByRole('button', { name: 'Norm entfernen' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Norm entfernen' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
    if (left === null) {
      expect(toast.success).toHaveBeenCalledWith('Norm entfernt.')
      expect(toast.warning).not.toHaveBeenCalled()
    } else {
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining(left))
    }
  })

  it('takes a confirmed entry off the norms at once, keeps its file, and brings it back as it was through the toast’s Rückgängig', async () => {
    const unlisting = { documentId: CONFIRMED.documentId, folderId: null, entryId: CONFIRMED.id, formerFolderId: CONFIRMED.folderId }
    const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith('/unlist') ? unlisting : CONFIRMED))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = renderSheet(CONFIRMED)
    await userEvent.click(await screen.findByRole('button', { name: 'Nicht mehr als Norm führen' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect([url, init.method]).toEqual(['/api/base-knowledge/oenorm-b-1600/unlist', 'POST'])
    const [message, options] = toast.success.mock.calls.at(-1) as unknown as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('„ÖNORM B 1600:2017“ ist jetzt eine normale Datei unter Ordner (oberste Ebene).')
    expect(options.action.label).toBe('Rückgängig')
    expect(capturePosthog).toHaveBeenCalledWith('norm_unlisted')
    expect(capturePosthog).not.toHaveBeenCalledWith('norm_relisted')
    options.action.onClick()
    await waitFor(() => expect(onChanged).toHaveBeenLastCalledWith(CONFIRMED))
    expect(capturePosthog).toHaveBeenLastCalledWith('norm_relisted')
    const [undoUrl, undoInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect([undoUrl, undoInit.method, JSON.parse(String(undoInit.body))]).toEqual([
      '/api/base-knowledge/oenorm-b-1600/relist',
      'POST',
      { folderId: CONFIRMED.folderId },
    ])
    expect(toast.success).toHaveBeenLastCalledWith('„ÖNORM B 1600:2017“ ist wieder als Norm geführt.')
  })

  it('returns a proposal that is no norm to its folder, remembered, and shows it there from the toast', async () => {
    const fetchMock = vi.fn(async () => Response.json({ results: [{ entryId: PROPOSAL.id, outcome: 'not_norm', error: null }] }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = renderSheet(PROPOSAL)
    expect(screen.queryByTestId('base-knowledge-unlist')).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Keine Norm' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect([url, init.method, JSON.parse(String(init.body))]).toEqual([
      '/api/base-knowledge/settle',
      'POST',
      { rows: [{ entryId: PROPOSAL.id, notNorm: true }] },
    ])
    const [message, options] = toast.success.mock.calls.at(-1) as unknown as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toMatch(/^„ÖNORM B 1300:2018“ ist keine Norm: Die Datei liegt wieder in ihrem Ordner, und .+ schlägt sie nicht noch einmal als Norm vor\.$/)
    expect(options.action.label).toBe('In Ordnern zeigen')
    options.action.onClick()
    expect(push).toHaveBeenCalledWith(`/app/office-shelf?doc=${encodeURIComponent(PROPOSAL.documentId)}`)
  })

  it('keeps a proposal on the page when settling it fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [{ entryId: PROPOSAL.id, outcome: 'failed', error: 'Gesperrt' }] })))
    const onChanged = renderSheet(PROPOSAL)
    await userEvent.click(await screen.findByRole('button', { name: 'Keine Norm' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Gesperrt'))
    expect(onChanged).not.toHaveBeenCalled()
  })
})
