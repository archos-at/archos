import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BaseKnowledgeList, NormRecognition } from '@/lib/base-knowledge/wire'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS, BASE_KNOWLEDGE_TERRITORIES } from '@/app/dev/_fixtures/base-knowledge'
import { countByFolder, countEntries } from '@/lib/base-knowledge/office/listing'
import { BaseKnowledgeWorkspace } from './base-knowledge-workspace'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace, back: navigation.back }),
  usePathname: () => '/app/base-knowledge',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({ fileUpload: { acceptedTypes: '.pdf,.docx', acceptedMimeTypes: ['application/pdf'], maxFileSize: 100 * 1024 * 1024 } }),
}))

const shelfUpload = vi.hoisted(() => ({ stored: [] as { documentId: string; fileName: string }[], collections: [] as (string | undefined)[] }))
vi.mock('@/features/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/documents')>()),
  useOfficeShelfDocuments: (options: { collectionName?: string; onStored?: (uploads: { documentId: string; fileName: string }[]) => void }) => {
    shelfUpload.collections.push(options.collectionName)
    return {
      uploadFiles: async (files: File[]) => {
        options.onStored?.(shelfUpload.stored)
        return files.length
      },
      isUploading: false,
      error: null,
      clearError: () => {},
    }
  },
}))

vi.mock('@/features/documents/file-preview', () => ({
  fileItemFromStatus: (body: { id: string; filename: string }) => ({ ...body }),
  FilePreviewDialog: ({ file, detailsLead, onClose }: { file: { filename: string } | null; detailsLead?: ReactNode; onClose: () => void }) =>
    file ? (
      <div role="dialog" aria-label={file.filename}>
        <button type="button" onClick={onClose}>close</button>
        {detailsLead}
      </div>
    ) : null,
}))

const RECOGNITION: NormRecognition = {
  proposals: [
    {
      entryId: 'edition_norm',
      documentId: 'doc-norm',
      fileName: 'OENORM_B_5371.pdf',
      kind: 'technical_standard',
      designation: 'ÖNORM B 5371',
      editionLabel: null,
      topicId: 'topic-treppen',
      editionOf: null,
      duplicate: false,
    },
    {
      entryId: 'edition_edition',
      documentId: 'doc-edition',
      fileName: 'OENORM_B_1600_2023-02-01_de.pdf',
      kind: 'technical_standard',
      designation: 'ÖNORM B 1600',
      editionLabel: '2023-02-01',
      topicId: 'topic-barrierefrei',
      editionOf: { entryId: 'edition_b1600', designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' },
      duplicate: false,
    },
  ],
  plain: [{ documentId: 'doc-plan', fileName: 'Plankopf_Vorlage_A0.pdf', folderId: null, folderPath: null, platformHeld: false }],
  topics: {
    rootId: 'folder-root',
    folders: [
      { id: 'topic-treppen', parentId: 'folder-root', name: 'Treppen', path: 'Grundlagen des Büros/Treppen', description: null },
      { id: 'topic-barrierefrei', parentId: 'folder-root', name: 'Barrierefreiheit', path: 'Grundlagen des Büros/Barrierefreiheit', description: null },
    ],
    nextCursor: null,
  },
}

const listOf = (entries = BASE_KNOWLEDGE_ENTRIES, canManage = true): BaseKnowledgeList => ({
  canManage,
  counts: countEntries(entries),
  territories: BASE_KNOWLEDGE_TERRITORIES,
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
      if (input.startsWith('/api/documents/')) return Response.json({ id: 'doc', filename: 'ÖNORM B 1600.pdf', status: 'completed' })
      return Response.json(list)
    }),
  )
  return calls
}

const renderWorkspace = () =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <TooltipProvider>
        <BaseKnowledgeWorkspace uploadCollection="archiv_org-1" />
      </TooltipProvider>
    </I18nProvider>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  navigation.push.mockReset()
  navigation.replace.mockReset()
  navigation.back.mockReset()
  navigation.search = ''
})

describe('BaseKnowledgeWorkspace', () => {
  it('opens on an explanation of what belongs here when the office has none', async () => {
    stubFetch(listOf([]), { rootId: null, folders: [], nextCursor: null })
    renderWorkspace()
    expect(await screen.findByText('Noch keine Grundlagen hinterlegt')).toBeTruthy()
    expect(screen.getByText(/gehören hierher, nicht Projektunterlagen oder Vorlagen/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Hochladen$/ }).length).toBeGreaterThan(0)
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

  it('uploads into the Büroablage and opens one dialog for the norms it recognised', async () => {
    shelfUpload.stored = [
      { documentId: 'doc-norm', fileName: 'OENORM_B_5371.pdf' },
      { documentId: 'doc-edition', fileName: 'OENORM_B_1600_2023-02-01_de.pdf' },
      { documentId: 'doc-plan', fileName: 'Plankopf_Vorlage_A0.pdf' },
    ]
    stubFetch(listOf())
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/base-knowledge/recognize') return Response.json(RECOGNITION)
      if (url === '/api/base-knowledge/settle') {
        return Response.json({
          results: [
            { entryId: 'edition_norm', outcome: 'confirmed', error: null },
            { entryId: 'edition_edition', outcome: 'edition_added', error: null },
          ],
        })
      }
      return answer(input, init)
    })
    renderWorkspace()
    await screen.findAllByTestId('base-knowledge-row')
    expect(shelfUpload.collections.at(-1)).toBe('archiv_org-1')
    await userEvent.upload(screen.getByTestId('project-upload-input'), [new File(['a'], 'a.pdf', { type: 'application/pdf' })])

    const dialog = await screen.findByTestId('norm-dialog')
    expect(within(dialog).getByText('2 Normen erkannt')).toBeTruthy()
    expect(within(dialog).getAllByTestId('norm-dialog-row')).toHaveLength(2)
    expect(within(dialog).getByTestId('norm-dialog-info').textContent).toBe('neue Ausgabe von ÖNORM B 1600 (bisher 2017-04-01)')
    expect(within(dialog).getByTestId('norm-dialog-plain').textContent).toBe(
      '1 weitere Datei ist keine Norm und liegt unter Ordner (oberste Ebene).',
    )
    const edition = within(dialog).getByRole('textbox', { name: 'Ausgabe: OENORM_B_5371.pdf' })
    expect(edition.getAttribute('aria-invalid')).toBe('true')
    await userEvent.type(edition, '2021-01-15')
    expect(edition.getAttribute('aria-invalid')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }))

    await waitFor(() => expect(screen.queryByTestId('norm-dialog')).toBeNull())
    const settle = fetchMock.mock.calls.find(([url]) => url === '/api/base-knowledge/settle')
    expect(JSON.parse(String(settle?.[1]?.body))).toEqual({
      rows: [
        { entryId: 'edition_norm', kind: 'technical_standard', designation: 'ÖNORM B 5371', editionLabel: '2021-01-15', topicId: 'topic-treppen' },
        { entryId: 'edition_edition', editionLabel: '2023-02-01' },
      ],
    })
  })

  it('leaves the norms proposed on Später, and Jetzt prüfen opens them again', async () => {
    const pending = BASE_KNOWLEDGE_ENTRIES.filter((entry) => entry.status === 'proposed')
    shelfUpload.stored = [{ documentId: 'doc-norm', fileName: 'OENORM_B_5371.pdf' }]
    const calls = stubFetch(listOf())
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/base-knowledge/recognize') return Response.json(RECOGNITION)
      if (String(input).includes('attention=proposed')) return Response.json(listOf(pending))
      return answer(input, init)
    })
    renderWorkspace()
    await userEvent.upload(await screen.findByTestId('project-upload-input'), [new File(['a'], 'a.pdf', { type: 'application/pdf' })])
    await userEvent.click(within(await screen.findByTestId('norm-dialog')).getByRole('button', { name: 'Später' }))
    await waitFor(() => expect(screen.queryByTestId('norm-dialog')).toBeNull())
    expect(calls.some((call) => call.url === '/api/base-knowledge/settle')).toBe(false)

    const line = screen.getByTestId('base-knowledge-pending')
    expect(line.textContent).toContain(`${pending.length} Normen warten auf Bestätigung.`)
    await userEvent.click(within(line).getByRole('button', { name: 'Jetzt prüfen' }))
    await screen.findByTestId('norm-dialog')
    const reopened = fetchMock.mock.calls.filter(([url]) => url === '/api/base-knowledge/recognize')
    expect(reopened).toHaveLength(2)
    expect(JSON.parse(String(reopened[1][1]?.body))).toEqual({ documentIds: pending.map((entry) => entry.documentId) })
  })

  it('sends a plain file to Ordner and says so, with the way there', async () => {
    shelfUpload.stored = [{ documentId: 'doc-plan', fileName: 'Plankopf_Vorlage_A0.pdf' }]
    stubFetch(listOf())
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/base-knowledge/recognize') {
        return Response.json({ ...RECOGNITION, proposals: [], plain: [{ ...RECOGNITION.plain[0], folderId: 'folder-plans', folderPath: 'Pläne' }] })
      }
      return answer(input, init)
    })
    renderWorkspace()
    await userEvent.upload(await screen.findByTestId('project-upload-input'), [new File(['a'], 'a.pdf', { type: 'application/pdf' })])

    await waitFor(() => expect(toast).toHaveBeenCalled())
    const [message, options] = toast.mock.calls.at(-1) as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('1 Datei unter Ordner › Pläne abgelegt. Sie ist keine Norm.')
    expect(options.action.label).toBe('In Ordnern zeigen')
    options.action.onClick()
    expect(navigation.push).toHaveBeenCalledWith('/app/office-shelf?folder=folder-plans')
    expect(screen.queryByTestId('norm-dialog')).toBeNull()
  })

  it('takes files dropped on the norms tab through the same upload', async () => {
    shelfUpload.stored = [{ documentId: 'doc-norm', fileName: 'OENORM_B_5371.pdf' }]
    stubFetch(listOf())
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => (String(input) === '/api/base-knowledge/recognize' ? Response.json(RECOGNITION) : answer(input, init)))
    renderWorkspace()
    const workspace = await screen.findByTestId('base-knowledge-workspace')
    const file = new File(['a'], 'OENORM_B_5371.pdf', { type: 'application/pdf' })
    fireEvent.drop(workspace, { dataTransfer: { files: [file], items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => file }], types: ['Files'] } })
    expect(await screen.findByTestId('norm-dialog')).toBeTruthy()
  })

  it('names the folder action of the norms tab a topic', async () => {
    stubFetch(listOf())
    renderWorkspace()
    await screen.findAllByTestId('base-knowledge-row')
    expect(screen.getByRole('button', { name: 'Thema anlegen' })).toBeTruthy()
  })

  it('holds the place under a scrim while the file loads, and a further press replaces rather than stacks', async () => {
    navigation.search = 'file=oenorm-b-1600'
    stubFetch(listOf())
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input, init) => (String(input).startsWith('/api/documents/') ? new Promise<Response>(() => {}) : answer(input, init)))
    renderWorkspace()
    expect(await screen.findByTestId('standard-file-loading')).toBeTruthy()
    const [first] = await screen.findAllByTestId('base-knowledge-row')
    await userEvent.click(within(first).getByTestId('base-knowledge-entry-name'), { pointerEventsCheck: 0 })
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('opens a standard as its file, from its row', async () => {
    stubFetch(listOf())
    renderWorkspace()
    const [first] = await screen.findAllByTestId('base-knowledge-row')
    await userEvent.click(within(first).getByTestId('base-knowledge-entry-name'))
    expect(navigation.push).toHaveBeenCalledWith(`/app/base-knowledge?file=${BASE_KNOWLEDGE_ENTRIES[0].id}`, { scroll: false })
  })

  it('shows the file with the standard’s facts beside it, and its page one press away', async () => {
    navigation.search = 'file=oenorm-b-1600'
    stubFetch(listOf())
    renderWorkspace()
    const viewer = await screen.findByRole('dialog', { name: 'ÖNORM B 1600.pdf' })
    const facts = within(viewer).getByTestId('standard-facts')
    expect(within(facts).getByText('Ausgabe')).toBeTruthy()
    expect(within(facts).getByText('Zuletzt geprüft')).toBeTruthy()
    await userEvent.click(within(facts).getByTestId('standard-facts-manage'))
    expect(navigation.replace).toHaveBeenCalledWith('/app/base-knowledge?entry=oenorm-b-1600', { scroll: false })
  })

  it('closes a file reached by a link to the list, without a step for the back button to undo', async () => {
    navigation.search = 'file=oenorm-b-1600'
    stubFetch(listOf())
    renderWorkspace()
    const viewer = await screen.findByRole('dialog', { name: 'ÖNORM B 1600.pdf' })
    await userEvent.click(within(viewer).getByRole('button', { name: 'close' }))
    expect(navigation.replace).toHaveBeenCalledWith('/app/base-knowledge', { scroll: false })
    expect(navigation.back).not.toHaveBeenCalled()
  })

  it('opens the file over a standard’s page, and closing it undoes the opening', async () => {
    navigation.search = 'entry=oenorm-b-1600'
    stubFetch(listOf())
    const { rerender } = renderWorkspace()
    await userEvent.click(await screen.findByTestId('base-knowledge-open-file'))
    expect(navigation.push).toHaveBeenCalledWith('/app/base-knowledge?entry=oenorm-b-1600&file=oenorm-b-1600', { scroll: false })
    navigation.search = 'entry=oenorm-b-1600&file=oenorm-b-1600'
    rerender(
      <I18nProvider initialLocale="de" fixedLocale>
        <TooltipProvider>
          <BaseKnowledgeWorkspace />
        </TooltipProvider>
      </I18nProvider>,
    )
    const viewer = await screen.findByRole('dialog', { name: 'ÖNORM B 1600.pdf' })
    await userEvent.click(within(viewer).getByRole('button', { name: 'close' }))
    expect(navigation.back).toHaveBeenCalled()
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

  it('says when a linked standard cannot be read, with a retry and the way back to the list', async () => {
    navigation.search = 'entry=gone'
    const list = listOf()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.startsWith('/api/base-knowledge/folders')) return Response.json(BASE_KNOWLEDGE_FOLDERS)
        if (input.startsWith('/api/base-knowledge/gone')) return Response.json({ detail: 'No base-knowledge entry with this id' }, { status: 404 })
        return Response.json(list)
      }),
    )
    renderWorkspace()
    expect(await screen.findByText(/Diese Grundlage konnte nicht geladen werden/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Erneut versuchen|Nochmal/ })).toBeTruthy()
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
    expect(screen.queryByTestId('project-upload-input')).toBeNull()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Neuer Ordner|Thema anlegen/ })).toBeNull()
    expect(screen.queryByTestId('base-knowledge-review-pending')).toBeNull()
  })
})
