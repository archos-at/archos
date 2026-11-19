import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS, BASE_KNOWLEDGE_TERRITORIES } from '@/app/dev/_fixtures/base-knowledge'
import { EntryPage } from './entry-page'

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
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
})

describe('EntryPage', () => {
  it('confirms a licensed proposal only with the office’s licence statement', async () => {
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

  it('keeps the way out of a proposal already stored as licensed while the office is not asked about licences', async () => {
    renderSheet(PROPOSAL)
    await userEvent.click(await screen.findByRole('radio', { name: /Frei zugänglich/ }))
    expect((screen.getByTestId('base-knowledge-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('asks no check of a work the platform lists, and says which edition applies today', async () => {
    renderSheet({ ...CONFIRMED, directory: { inForce: { editionLabel: '2023-02-01', startsOn: '2023-02-01' }, held: false } })
    const section = await screen.findByTestId('base-knowledge-check')
    expect(within(section).getByText('Mit dem Normenverzeichnis abgeglichen: Heute gilt die Ausgabe 2023-02-01, seit 01.02.2023.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ist noch aktuell' })).toBeNull()
    expect(within(section).getByRole('button', { name: /Neuere Ausgabe hochladen/ })).toBeTruthy()
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
    await userEvent.click(await screen.findByRole('button', { name: 'Grundlage entfernen' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Grundlage entfernen' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
    if (left === null) {
      expect(toast.success).toHaveBeenCalledWith('Grundlage entfernt.')
      expect(toast.warning).not.toHaveBeenCalled()
    } else {
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining(left))
    }
  })
})
