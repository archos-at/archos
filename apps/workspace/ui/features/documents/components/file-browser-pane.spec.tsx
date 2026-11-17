import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen, within } from '@/test-utils'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import userEvent from '@testing-library/user-event'
import { FileBrowserPane } from './file-browser-pane'
import { FileSearchField } from './file-search-bar'
import { useFileSearch } from '../hooks/use-file-search'
import { projectSearchScope } from '../lib/file-shelf'
import { documentSearchAnswer, fileSearchHit } from '@/test-utils/search-answers'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileItem, FolderItem } from './project-file-workspace'

const files: FileItem[] = [
  {
    id: 'f1',
    filename: 'site-plan.pdf',
    displayName: null,
    fileSize: 1024,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
  },
  {
    id: 'f2',
    filename: 'permit.pdf',
    displayName: null,
    fileSize: 2048,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-01-02T00:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
  },
]

type PaneProps = Parameters<typeof FileBrowserPane>[0]
type HarnessProps = Omit<Partial<PaneProps>, 'search'> & {
  projectId?: string
}

function Harness({ projectId, ...paneProps }: HarnessProps) {
  const t = useTranslations(filesCopy)
  const search = useFileSearch(projectId ? projectSearchScope(projectId) : undefined)
  return (
    <>
      <FileSearchField
        value={search.query}
        onChange={search.setQuery}
        onSubmit={search.run}
        onClear={search.clear}
        placeholder={search.canSearch ? t('browser.semantic.searchPlaceholder') : t('browser.searchPlaceholder')}
        searchLabel={t('browser.searchLabel')}
        resetLabel={t('browser.resetSearch')}
      />
      <FileBrowserPane
        files={files}
        selectedFileId={null}
        onSelectFile={vi.fn()}
        isLoading={false}
        {...paneProps}
        search={search}
      />
    </>
  )
}

function renderPane(overrides: HarnessProps = {}) {
  return render(<Harness {...overrides} />)
}

describe('FileBrowserPane — card grid', () => {
  it('renders one card per file with a content-aware skeleton thumbnail', async () => {
    const restoreObservers = installLayoutObservers({ intersecting: true })
    try {
      renderPane()
      const cards = screen.getAllByTestId('file-card')
      expect(cards).toHaveLength(2)
      const sitePlanCard = cards.find((c) => within(c).queryByText('site-plan.pdf'))!
      expect(await within(sitePlanCard).findByTestId('document-kind-thumbnail')).toHaveAttribute(
        'data-kind',
        'siteplan'
      )
      const permitCard = cards.find((c) => within(c).queryByText('permit.pdf'))!
      expect(await within(permitCard).findByTestId('document-kind-thumbnail')).toHaveAttribute(
        'data-kind',
        'notice'
      )
    } finally {
      restoreObservers()
    }
  })

  it('says the format and size in the facts line, and a status badge only when the document is not citable', () => {
    const { unmount } = renderPane()
    const card = screen.getAllByTestId('file-card').find((c) => within(c).queryByText('site-plan.pdf'))!
    const footer = card.nextElementSibling as HTMLElement
    expect(within(footer).getByText('PDF')).toBeInTheDocument()
    expect(within(footer).getByText(/1 kB/)).toBeInTheDocument()
    expect(within(card).queryByText('Citable')).not.toBeInTheDocument()
    unmount()

    renderPane({ files: [{ ...files[0], status: 'processing' }] })
    expect(within(screen.getByTestId('file-card')).getByText('Reading')).toBeInTheDocument()
  })

  it('surfaces the failure reason on failed cards', () => {
    renderPane({
      files: [{ ...files[0], status: 'failed', errorMessage: 'Request timed out after 180s' }],
    })
    expect(screen.getByText(/Reading took too long and was stopped/)).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('marks the card the preview is showing with aria-current', () => {
    renderPane({ selectedFileId: 'f1' })
    const cards = screen.getAllByTestId('file-card')
    const selected = cards.find((c) => within(c).queryByText('site-plan.pdf'))!
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(selected).not.toHaveAttribute('aria-pressed')
  })

  it('draws no upload tile among the files: the header uploads and the whole page takes a drop', () => {
    renderPane({})
    expect(screen.queryByTestId('project-upload-dropcard')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('file-card')).toHaveLength(files.length)
  })
})

describe('FileBrowserPane — document descriptions', () => {
  it('keeps the AI-generated description off the tile and on the list view\'s row', () => {
    const withSummary: FileItem[] = [
      { ...files[0], summary: 'A ground-floor plan of the east wing.' },
      files[1],
    ]
    const { unmount } = renderPane({ files: withSummary })
    expect(screen.queryByText('A ground-floor plan of the east wing.')).not.toBeInTheDocument()
    unmount()
    renderPane({ files: withSummary, view: 'list' })
    expect(screen.getByText('A ground-floor plan of the east wing.')).toBeInTheDocument()
  })
})

describe('FileBrowserPane — folder drill-down', () => {
  const folders: FolderItem[] = [
    { id: 'root-1', parentId: null, name: 'Pläne', path: '/Pläne' },
    { id: 'root-2', parentId: null, name: 'Bescheide', path: '/Bescheide' },
    { id: 'child-1', parentId: 'root-1', name: 'EG', path: '/Pläne/EG' },
  ]

  const folderNav = (currentFolderId: string | null, onNavigate = vi.fn()) => ({
    folders,
    currentFolderId,
    onNavigate,
    onCreateFolder: vi.fn(async () => true),
    onRenameFolder: vi.fn(async () => true),
    onDeleteFolder: vi.fn(async () => true),
  })

  it('renders the current level’s folders as cards (only), and clicking one drills in', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderPane({ folderNav: folderNav(null, onNavigate) })

    expect(screen.getByRole('button', { name: 'Open folder “Pläne”' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open folder “Bescheide”' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open folder “EG”' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open folder “Pläne”' }))
    expect(onNavigate).toHaveBeenCalledWith('root-1')
  })

  it('names the path in the breadcrumb, every ancestor a click back out', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderPane({
      files: [],
      searchFiles: files,
      folderNav: folderNav('child-1', onNavigate),
    })

    const breadcrumb = screen.getByRole('navigation', { name: 'Folder path' })
    expect(within(breadcrumb).getByText('EG')).toBeInTheDocument()
    await user.click(within(breadcrumb).getByRole('button', { name: 'Pläne' }))
    expect(onNavigate).toHaveBeenCalledWith('root-1')
    await user.click(within(breadcrumb).getByRole('button', { name: 'All Files' }))
    expect(onNavigate).toHaveBeenCalledWith(null)
  })

  it('counts what is directly inside a folder on its card', () => {
    renderPane({
      files,
      searchFiles: [{ ...files[0], folderId: 'root-1' }, files[1]],
      folderNav: folderNav(null),
    })
    const card = screen.getByTestId('folder-card-root-1')
    expect(within(card).getByText('2 items')).toBeInTheDocument()
  })

  it('lists the level’s folders as the first rows of the file table, under its head', () => {
    renderPane({ folderNav: folderNav(null), view: 'list' })
    const row = screen.getByTestId('folder-row-root-1')
    expect(row.tagName).toBe('TR')
    const table = row.closest('table')
    expect(table).toBe(screen.getByTestId('file-list-view'))
    expect(table?.querySelector('tbody > tr')).toBe(row)
    expect(row.className).not.toMatch(/\brounded|\bshadow/)
  })

  it('draws every level in one grammar: its folders first, then its files, each labelled when both are there', () => {
    renderPane({ files: [{ ...files[0], folderId: 'root-1' }], folderNav: folderNav('root-1') })
    const folderTiles = screen.getByTestId('folder-tiles')
    expect(within(folderTiles).getByTestId('folder-card-child-1')).toBeInTheDocument()
    expect(within(folderTiles).queryByTestId('file-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('folders-label')).toHaveTextContent('Folders')
    expect(screen.getByText('Files', { selector: 'p' })).toBeInTheDocument()
    expect(folderTiles.compareDocumentPosition(screen.getByTestId('file-card')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('labels neither kind where the level holds only one', () => {
    renderPane({ files: [], searchFiles: files, folderNav: folderNav(null) })
    expect(screen.getByTestId('folder-tiles')).toBeInTheDocument()
    expect(screen.queryByTestId('folders-label')).not.toBeInTheDocument()
  })

  it('starts each result’s meta line with the folder it lies in: a search spans every folder', async () => {
    const user = userEvent.setup()
    renderPane({ files: [], searchFiles: [{ ...files[1], folderId: 'root-2' }], folderNav: folderNav(null) })
    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'permit')
    expect(screen.getByTestId('file-card-where')).toHaveTextContent('Bescheide')
  })

  it('keeps „Select“ in place where the level holds only folders, disabled, so nothing moves under the pointer', () => {
    renderPane({ files: [], searchFiles: files, folderNav: folderNav(null), selection: { active: false, selectedIds: new Set(), onToggle: vi.fn(), onStart: vi.fn() } })
    expect(screen.getByTestId('selection-start')).toBeDisabled()
  })

  it('marks an empty level so its own Hochladen is the pane’s one ink press', () => {
    const { container } = renderPane({ files: [], searchFiles: files, folderNav: folderNav('root-2') })
    expect(container.querySelector('[data-empty-level]')).not.toBeNull()
  })

  it('a typed query escapes the current folder and searches the corpus', async () => {
    const user = userEvent.setup()
    renderPane({
      files: [],
      searchFiles: files,
      folderNav: folderNav('root-2'),
    })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'permit')
    expect(screen.getByText('permit.pdf')).toBeInTheDocument()
  })

  it('lifts no document out of a level the reader may only read; the server would refuse the move', () => {
    const readOnly = folders.map((folder) => (folder.id === 'root-2' ? { ...folder, access: 'read' as const } : folder))
    const liftingCards = (container: HTMLElement) =>
      screen.getAllByTestId('file-card').filter((card) => card.closest('[draggable="true"]') && container.contains(card))

    const readOnlyLevel = renderPane({
      folderNav: { ...folderNav('root-2'), folders: readOnly },
      onDropDocumentInFolder: vi.fn(),
    })
    expect(liftingCards(readOnlyLevel.container)).toHaveLength(0)
    readOnlyLevel.unmount()

    const writableLevel = renderPane({
      folderNav: { ...folderNav('root-1'), folders: readOnly },
      onDropDocumentInFolder: vi.fn(),
    })
    expect(liftingCards(writableLevel.container)).toHaveLength(files.length)
  })

  it('renders no folder navigation without folderNav', () => {
    renderPane()
    expect(screen.queryByRole('navigation', { name: 'Folder path' })).not.toBeInTheDocument()
  })
})

describe('FileBrowserPane — search', () => {
  it('matches tags and summaries, not just filenames', async () => {
    const user = userEvent.setup()
    renderPane({
      files: [
        { ...files[0], tags: ['Brandschutz'] },
        { ...files[1], summary: 'Fluchtweg im zweiten Obergeschoss.' },
      ],
    })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'brandschutz')
    expect(screen.getByText('site-plan.pdf')).toBeInTheDocument()
    expect(screen.queryByText('permit.pdf')).not.toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: /search files/i }))
    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fluchtweg')
    expect(screen.getByText('permit.pdf')).toBeInTheDocument()
    expect(screen.queryByText('site-plan.pdf')).not.toBeInTheDocument()
  })

  it('offers an inline reset button while a query is entered', async () => {
    const user = userEvent.setup()
    renderPane()

    expect(screen.queryByRole('button', { name: /reset search/i })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'plan')
    await user.click(screen.getByRole('button', { name: /reset search/i }))
    expect(screen.getByRole('textbox', { name: /search files/i })).toHaveValue('')
    expect(screen.getByText('permit.pdf')).toBeInTheDocument()
  })
})

describe('FileBrowserPane — semantic search (explicit run)', () => {
  const searchAnswer = documentSearchAnswer([
    fileSearchHit(
      { ...files[0], filename: 'site-plan.pdf', displayName: null },
      { text: 'The second escape route runs along the north facade.', page: 4 }
    ),
  ])

  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/search?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(searchAnswer) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('says the search failed rather than reporting an empty corpus', async () => {
    fetchMock.mockImplementation((url: string | URL) =>
      String(url).includes('/api/search?')
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    )
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fire escape{Enter}')

    expect(await screen.findAllByText(/could not be run/i)).toHaveLength(1)
    expect(screen.queryByText(/no semantic matches/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/0 results/i)).not.toBeInTheDocument()
  })

  it('retries the SAME query, instead of only offering to give up', async () => {
    let attempt = 0
    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (!href.includes('/api/search?')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      attempt += 1
      return attempt === 1
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(searchAnswer) })
    })
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fire escape{Enter}')
    await user.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByTestId('semantic-match')).toBeInTheDocument()
    expect(attempt).toBe(2)
  })

  it('answers a search in the view the reader chose, not always in cards', async () => {
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1', view: 'list' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fire escape{Enter}')

    expect(await screen.findByTestId('file-list-view')).toBeInTheDocument()
    expect(screen.queryByTestId('semantic-match')).not.toBeInTheDocument()
    expect(await screen.findAllByTestId('file-list-row')).not.toHaveLength(0)
    expect(screen.queryByTestId('file-list-relevance')).toBeNull()
  })

  it('waits in the shape of the view the answer will arrive in', async () => {
    let release: () => void = () => undefined
    fetchMock.mockImplementation((url: string | URL) =>
      String(url).includes('/api/search?')
        ? new Promise((resolve) => {
            release = () => resolve({ ok: true, json: () => Promise.resolve(searchAnswer) })
          })
        : Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    )
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1', view: 'list' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fire escape{Enter}')

    expect(await screen.findByTestId('file-list-skeleton')).toBeInTheDocument()
    release()
    expect(await screen.findByTestId('file-list-view')).toBeInTheDocument()
  })

  it('shows no search button (and no semantic call) without a projectId', () => {
    renderPane()
    expect(screen.queryByRole('button', { name: /^search$/i })).not.toBeInTheDocument()
  })

  it('keeps the instant substring filter working as you type, before any semantic run', async () => {
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'permit')
    expect(screen.getByText('permit.pdf')).toBeInTheDocument()
    expect(screen.queryByText('site-plan.pdf')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/search?'))).toBe(false)
  })

  it('runs the semantic search on Enter and renders the snippet and page', async () => {
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fire escape{Enter}')

    expect(screen.queryByText(/semantic search:/i)).not.toBeInTheDocument()

    const match = await screen.findByTestId('semantic-match')
    expect(match).toHaveTextContent(/second escape route/i)
    expect(within(match).getByTestId('semantic-page')).toHaveTextContent(/page 4/i)
    expect(within(match).queryByText(/%/)).not.toBeInTheDocument()

    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/search?'))
    expect(String(call?.[0])).toBe('/api/search?projectId=proj-1')
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      text: 'fire escape',
      kinds: ['document'],
      facets: false,
    })
  })

  it('clearing the field returns to the normal list', async () => {
    const user = userEvent.setup()
    renderPane({ projectId: 'proj-1' })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'fire escape{Enter}')
    await screen.findByTestId('semantic-match')

    await user.click(screen.getByRole('button', { name: /reset search/i }))

    expect(screen.queryByTestId('semantic-match')).not.toBeInTheDocument()
    expect(screen.getByText('site-plan.pdf')).toBeInTheDocument()
    expect(screen.getByText('permit.pdf')).toBeInTheDocument()
  })
})

describe('FileBrowserPane — search zero-match', () => {
  it('shows an EmptyState with a Clear-search action when nothing matches', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'zzzz')

    expect(screen.getByText(/no files match/i)).toBeInTheDocument()
    expect(screen.getByText(/“zzzz”/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
    expect(screen.queryByText('site-plan.pdf')).not.toBeInTheDocument()
  })

  it('restores the full list when Clear search is clicked', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'zzzz')
    await user.click(screen.getByRole('button', { name: /clear search/i }))

    expect(screen.getByText('site-plan.pdf')).toBeInTheDocument()
    expect(screen.getByText('permit.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument()
  })
})


describe('FileBrowserPane — a filter emptied the level', () => {
  const notice = {
    title: 'Piloti hat hier noch nichts abgelegt',
    description: 'Hier erscheinen die Dateien, die Piloti selbst erstellt hat.',
    onClear: vi.fn(),
  }

  beforeEach(() => notice.onClear.mockClear())

  it('says which filter emptied it, instead of that the folder is empty', () => {
    renderPane({ files: [], filterEmptyNotice: notice })

    expect(screen.getByText(notice.title)).toBeInTheDocument()
    expect(screen.getByText(notice.description)).toBeInTheDocument()
    expect(screen.queryByText('This folder is empty')).not.toBeInTheDocument()
  })

  it('offers the way out that actually applies — widen the filter, not upload', async () => {
    const user = userEvent.setup()
    renderPane({
      files: [],
      filterEmptyNotice: notice,
      uploadControl: <button type="button">Upload a file</button>,
    })

    expect(screen.queryByText('Upload a file')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(notice.onClear).toHaveBeenCalled()
  })

  it('leaves the genuine empty folder alone', () => {
    renderPane({ files: [], filterEmptyNotice: null, uploadControl: <button type="button">Upload a file</button> })

    expect(screen.getByText('Upload a file')).toBeInTheDocument()
    expect(screen.queryByText(notice.title)).not.toBeInTheDocument()
  })
})

describe('FileBrowserPane — loading', () => {
  const folderNav = {
    folders: [] as FolderItem[],
    currentFolderId: null,
    onNavigate: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
  }

  it('draws the folder tiles it is about to be replaced by, and no path row the root no longer has', () => {
    renderPane({ isLoading: true, folderNav })

    const skeleton = screen.getByTestId('file-browser-skeleton')
    expect(within(skeleton).queryByTestId('folder-breadcrumb-skeleton')).not.toBeInTheDocument()
    expect(within(skeleton).getAllByTestId('folder-card-skeleton').length).toBeGreaterThan(0)
  })

  it('leaves the folder tiles out on a surface that has no folders', () => {
    renderPane({ isLoading: true })
    const skeleton = screen.getByTestId('file-browser-skeleton')
    expect(within(skeleton).queryByTestId('folder-card-skeleton')).not.toBeInTheDocument()
  })

  it('takes the shape of the view the reader chose', () => {
    renderPane({ isLoading: true, view: 'list', folderNav })
    const skeleton = screen.getByTestId('file-browser-skeleton')
    expect(within(skeleton).getByTestId('file-list-skeleton')).toBeInTheDocument()
    expect(within(skeleton).getByText('Name')).toBeInTheDocument()
  })
})

describe('FileBrowserPane — folder aggregates', () => {
  const tree: FolderItem[] = [
    { id: 'root-a', parentId: null, name: 'Einreichung', path: 'Einreichung' },
    { id: 'child-a', parentId: 'root-a', name: 'Plaene', path: 'Einreichung/Plaene' },
  ]
  const corpus: FileItem[] = [
    { ...files[0], id: 'in-root', folderId: 'root-a', createdAt: '2026-01-01T00:00:00Z' },
    { ...files[1], id: 'in-child', folderId: 'child-a', createdAt: '2026-03-09T00:00:00Z' },
  ]

  it('counts direct children only, and reports the newest date from the whole subtree', () => {
    renderPane({
      files: [],
      searchFiles: corpus,
      folderNav: {
        folders: tree,
        currentFolderId: null,
        onNavigate: vi.fn(),
        onCreateFolder: vi.fn(),
        onRenameFolder: vi.fn(),
        onDeleteFolder: vi.fn(),
      },
    })

    const card = screen.getByTestId('folder-card-root-a')
    expect(within(card).getByText('2 items')).toBeInTheDocument()
    expect(within(card).queryByRole('time')).not.toBeInTheDocument()
  })

  it('counts one entry per document: a replaced Fassung leaves the tile unless older ones are shown', () => {
    const older: FileItem = {
      ...files[1],
      id: 'older',
      folderId: 'root-a',
      status: 'failed',
      revision: { supersededBy: { id: 'in-root', filename: 'x.pdf' }, supersedes: [], suggestion: null, changeSummary: null },
    }
    const nav = {
      folders: tree,
      currentFolderId: null,
      onNavigate: vi.fn(),
      onCreateFolder: vi.fn(),
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    }
    const { unmount } = renderPane({ files: [], searchFiles: [...corpus, older], folderNav: nav })
    expect(within(screen.getByTestId('folder-card-root-a')).getByText('2 items')).toBeInTheDocument()
    unmount()

    const list = renderPane({ files: [], searchFiles: [...corpus, older], folderNav: nav, view: 'list' })
    expect(
      within(screen.getByTestId('folder-row-root-a')).queryByTestId('folder-read-state')?.getAttribute('data-state')
    ).not.toBe('failed')
    list.unmount()

    renderPane({ files: [], searchFiles: [...corpus, older], folderNav: nav, showOlderRevisions: true })
    expect(within(screen.getByTestId('folder-card-root-a')).getByText('3 items')).toBeInTheDocument()
  })

  it('says on a folder tile only what departs from „all read“, in words, and spells the state out on the list view\'s row', () => {
    const failed: FileItem = { ...files[1], id: 'broken', folderId: 'root-a', status: 'failed' }
    const nav = {
      folders: tree,
      currentFolderId: null,
      onNavigate: vi.fn(),
      onCreateFolder: vi.fn(),
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    }
    const { unmount } = renderPane({ files: [], searchFiles: [...corpus, failed], folderNav: nav })
    const dot = within(screen.getByTestId('folder-card-root-a')).getByTestId('folder-read-state')
    expect(dot).toHaveAttribute('data-state', 'failed')
    expect(within(dot).getByText('1 failed')).not.toHaveClass('sr-only')
    unmount()

    renderPane({ files: [], searchFiles: [...corpus, failed], folderNav: nav, view: 'list' })
    expect(within(screen.getByTestId('folder-row-root-a')).getByTestId('folder-read-state')).toHaveAttribute(
      'data-state',
      'failed'
    )
  })

  it('survives a parent cycle in the folder rows rather than overflowing the stack', () => {
    const cyclic: FolderItem[] = [
      { id: 'a', parentId: 'b', name: 'A', path: 'A' },
      { id: 'b', parentId: 'a', name: 'B', path: 'B' },
    ]
    expect(() =>
      renderPane({
        files: [],
        searchFiles: [],
        folderNav: {
          folders: cyclic,
          currentFolderId: null,
          onNavigate: vi.fn(),
          onCreateFolder: vi.fn(),
          onRenameFolder: vi.fn(),
          onDeleteFolder: vi.fn(),
        },
      }),
    ).not.toThrow()
  })
})

describe('FileBrowserPane — server-rendered markup', () => {
  const folderNav = {
    folders: [{ id: 'f1', parentId: null, name: 'Brandschutz', path: 'Brandschutz' }],
    currentFolderId: null,
    onNavigate: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
  }

  it('paints the level and its tiles at full opacity before any JavaScript runs', () => {
    const html = renderToStaticMarkup(<Harness folderNav={folderNav} />)
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/)
    expect(html).toContain('site-plan.pdf')
    expect(html).toContain('Brandschutz')
  })
})

describe('FileBrowserPane — older Fassungen in search', () => {
  const older: FileItem = {
    ...files[0],
    id: 'old',
    filename: 'plan_v1.pdf',
    revision: { supersededBy: { id: 'current', filename: 'current.pdf' }, supersedes: [], suggestion: null, changeSummary: null },
  }
  const current: FileItem = {
    ...files[1],
    id: 'current',
    filename: 'current.pdf',
    revision: {
      supersededBy: null,
      supersedes: [{ id: 'old', filename: 'plan_v1.pdf' }],
      suggestion: null,
      changeSummary: null,
      history: [{ id: 'old', filename: 'plan_v1.pdf', createdAt: null, changeSummary: null }],
    },
  }

  it('finds the current document by the name of an older Fassung, once', async () => {
    const user = userEvent.setup()
    renderPane({ files: [older, current] })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'plan_v1')
    expect(screen.getByText('current.pdf')).toBeInTheDocument()
    expect(screen.queryByText('plan_v1.pdf')).not.toBeInTheDocument()
  })

  it('lists the older Fassung among the matches when older Fassungen are shown', async () => {
    const user = userEvent.setup()
    renderPane({ files: [older, current], showOlderRevisions: true })

    await user.type(screen.getByRole('textbox', { name: /search files/i }), 'plan_v1')
    expect(screen.getByText('current.pdf')).toBeInTheDocument()
    expect(screen.getByText('plan_v1.pdf')).toBeInTheDocument()
  })
})
