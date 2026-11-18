import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import type { DocumentWireRow } from '../lib/file-item'
import { PRODUCT_NAME } from '@/lib/brand'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { findFileButton, renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'

const mockUploadFiles = vi.fn()

const routerReplace = vi.fn()
const routerPush = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => routerPush(...args),
    replace: (...args: unknown[]) => routerReplace(...args),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => searchParams,
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    loading: vi.fn(() => 'reading'),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: () => true,
}))

const media = vi.hoisted(() => ({ phone: false }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }))

vi.mock('@/features/bim/components/ifc-file-preview', () => ({
  IfcFilePreview: () => <div data-testid="ifc-file-preview" />,
}))

vi.mock('@/features/knowledge/components/pdf-viewer-dialog', () => ({
  PdfViewerDialog: () => null,
}))

vi.mock('../hooks/use-project-documents', () => ({
  useProjectDocuments: vi.fn().mockImplementation(() => ({
    uploadFiles: mockUploadFiles,
    retryFile: vi.fn(),
    isUploading: false,
    trackedFiles: [],
    error: null,
    clearError: vi.fn(),
  })),
}))

vi.mock('@/components/shell/project-section-frame', () => ({
  ProjectSectionActions: ({ children }: { children: ReactNode }) => children,
  ProjectSectionTabActions: () => null,
  useSectionTabActionsSlot: () => false,
  ProjectSectionPlace: () => null,
  useSectionPlaceSlot: () => false,
  useSectionToolTier: () => null,
  SectionLevelTools: () => null,
  useSectionNewFolder: () => null,
  useSectionPrimaryYields: () => false,
  useInSectionToolRow: () => false,
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

let probeShelf: DocumentWireRow[] = []
let probedNames: string[][] = []

beforeEach(() => {
  probeShelf = []
  probedNames = []
  server.use(
    http.post('/api/documents/name-matches', async ({ request }) => {
      const { names } = (await request.json()) as { names: string[] }
      probedNames.push(names)
      const fold = (name: string) => name.normalize('NFC').trim().toLowerCase()
      const wanted = new Set(names.map(fold))
      const documents = probeShelf
        .filter((doc) => doc.authoredBy !== 'agent')
        .filter((doc) => [doc.filename, doc.displayName].some((name) => name && wanted.has(fold(name))))
        .map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          displayName: doc.displayName ?? null,
          fileSize: doc.fileSize,
          contentHash: doc.contentHash ?? null,
          status: doc.status ?? 'completed',
          folderId: doc.folderId ?? null,
          authoredBy: doc.authoredBy ?? 'user',
          lifecycle: doc.lifecycle ?? 'active',
        }))
      return HttpResponse.json({ documents })
    }),
  )
})

describe('ProjectFileWorkspace — server-seeded first paint', () => {
  const seededFile = {
    id: 'doc-seed',
    filename: 'Einreichplan.pdf',
    displayName: null,
    fileSize: 2048,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00.000Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    assignees: [],
    authoredBy: 'user' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  it('renders the seeded corpus without asking for it again', async () => {
    const documentsRequests: string[] = []
    const folderRequests: string[] = []
    server.use(
      http.get('/api/documents', ({ request }) => {
        documentsRequests.push(request.url)
        return HttpResponse.json({ documents: [] })
      }),
      http.get('/api/projects/:projectId/folders', ({ request }) => {
        folderRequests.push(request.url)
        return HttpResponse.json({ folders: [] })
      }),
    )

    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[seededFile]}
        initialFolders={[{ id: 'folder-1', parentId: null, name: 'Brandschutz', path: 'Brandschutz' }]}
      />,
    )

    expect(await findFileButton(/Einreichplan\.pdf/)).toBeInTheDocument()
    expect(screen.getByTestId('folder-card-folder-1')).toBeInTheDocument()
    expect(screen.queryByTestId('file-browser-skeleton')).not.toBeInTheDocument()

    await waitFor(() => expect(mockUploadFiles).not.toHaveBeenCalled())
    expect(documentsRequests).toHaveLength(0)
    expect(folderRequests).toHaveLength(0)
  })

  it('still fetches when the caller has nothing to seed with', async () => {
    let documentsRequests = 0
    server.use(
      http.get('/api/documents', () => {
        documentsRequests += 1
        return HttpResponse.json({ documents: [seededFile] })
      }),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )

    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />,
    )

    expect(await findFileButton(/Einreichplan\.pdf/)).toBeInTheDocument()
    expect(documentsRequests).toBe(1)
  })

  it('re-reads the listing when the authorship chip narrows it server-side', async () => {
    const requested: string[] = []
    server.use(
      http.get('/api/documents', ({ request }) => {
        requested.push(new URL(request.url).searchParams.get('authoredBy') ?? '')
        return HttpResponse.json({ documents: [] })
      }),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )

    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[seededFile]}
        initialFolders={[]}
      />,
    )
    expect(await findFileButton(/Einreichplan\.pdf/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /filter/i }))
    await userEvent.click(await screen.findByLabelText(`By ${PRODUCT_NAME}`))

    await waitFor(() => expect(requested).toEqual(['agent']))
  })
})

describe('ProjectFileWorkspace — the authorship filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  it('asks the LISTING for agent-authored rows rather than filtering what it already has', async () => {
    const searches: string[] = []
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', ({ request }) => {
        searches.push(new URL(request.url).search)
        return HttpResponse.json({ documents: [] })
      }),
    )

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    await waitFor(() => expect(searches.length).toBeGreaterThan(0))
    expect(searches[0]).not.toContain('authoredBy')

    await userEvent.click(screen.getByTestId('file-filter-menu-trigger'))
    await userEvent.click(await screen.findByLabelText(`By ${PRODUCT_NAME}`))

    await waitFor(() => expect(searches.at(-1)).toContain('authoredBy=agent'))
    expect(searches.at(-1)).toContain('projectId=proj-1')
  })

  it('goes back to the whole estate when the chip is released', async () => {
    const searches: string[] = []
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', ({ request }) => {
        searches.push(new URL(request.url).search)
        return HttpResponse.json({ documents: [] })
      }),
    )

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(searches.length).toBeGreaterThan(0))

    await userEvent.click(screen.getByTestId('file-filter-menu-trigger'))
    const check = await screen.findByLabelText(`By ${PRODUCT_NAME}`)
    await userEvent.click(check)
    await waitFor(() => expect(searches.at(-1)).toContain('authoredBy=agent'))
    await userEvent.click(check)

    await waitFor(() => expect(searches.at(-1)).not.toContain('authoredBy'))
  })
})

describe('ProjectFileWorkspace — a filter keeps what it matches', () => {
  const DOCUMENTS = [
    {
      id: 'doc-photo',
      filename: 'foto.jpg',
      fileSize: 1024,
      contentType: 'image/jpeg',
      status: 'ready',
      folderId: null,
      createdAt: '2026-01-01T00:00:00Z',
      errorMessage: null,
    },
    {
      id: 'doc-report',
      filename: 'bericht.pdf',
      fileSize: 2048,
      contentType: 'application/pdf',
      status: 'ready',
      folderId: null,
      createdAt: '2026-01-02T00:00:00Z',
      errorMessage: null,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => HttpResponse.json({ documents: DOCUMENTS })),
    )
  })

  const openMenu = async () => {
    await userEvent.click(screen.getByTestId('file-filter-menu-trigger'))
  }

  it('keeps listing the files a kind filter matches, instead of the empty-filter panel', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await findFileButton(/foto\.jpg/i)
    await openMenu()
    await userEvent.click(await screen.findByLabelText('Photo'))

    expect(await findFileButton(/foto\.jpg/i)).toBeInTheDocument()
    expect(screen.queryByText('bericht.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  })

  it('says a filter emptied the level only when the level really is empty, and clearing restores it', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await findFileButton(/foto\.jpg/i)
    await openMenu()
    await userEvent.click(await screen.findByLabelText('3D model (IFC)'))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByText('foto.jpg')).not.toBeInTheDocument()
    expect(screen.queryByText('bericht.pdf')).not.toBeInTheDocument()
    const clear = await screen.findByRole('button', { name: /clear filters/i })
    await userEvent.click(clear)

    expect(await findFileButton(/foto\.jpg/i)).toBeInTheDocument()
    expect(await findFileButton(/bericht\.pdf/i)).toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — a folder larger than one page', () => {
  const row = (id: string, filename: string): DocumentWireRow => ({
    id,
    filename,
    displayName: null,
    fileSize: 10,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00.000Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    assignees: [],
    authoredBy: 'user' as const,
  })
  const newest = row('doc-new', 'Neu-Plan.pdf')
  const oldest = row('doc-old', 'EG.pdf')

  let cursors: Array<string | null>
  let levels: Array<string | null>

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    cursors = []
    levels = []
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams
        const cursor = params.get('cursor')
        cursors.push(cursor)
        levels.push(params.get('folderId'))
        return cursor === 'page-2'
          ? HttpResponse.json({ documents: [oldest], nextCursor: null })
          : HttpResponse.json({ documents: [newest], nextCursor: 'page-2' })
      }),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
  })

  it('reads the first page of the level, and the next one only when the reader reaches the end', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    expect(await findFileButton(/Neu-Plan\.pdf/)).toBeInTheDocument()
    expect(cursors).toEqual([null])
    expect(levels).toEqual(['root'])
    expect(screen.queryByText('EG.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText(/showing the newest/i)).not.toBeInTheDocument()

    fireEvent.click(await screen.findByTestId('load-more-button'))
    expect(await findFileButton(/EG\.pdf/)).toBeInTheDocument()
    expect(await findFileButton(/Neu-Plan\.pdf/)).toBeInTheDocument()
    expect(cursors).toEqual([null, 'page-2'])
    await waitFor(() => expect(screen.queryByTestId('load-more-button')).not.toBeInTheDocument())
  })

  it('keeps the first page on screen while the next one is on its way', async () => {
    let releaseSecondPage: () => void = () => undefined
    const secondPageHeld = new Promise<void>((resolve) => {
      releaseSecondPage = resolve
    })
    server.use(
      http.get('/api/documents', async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        if (cursor !== 'page-2') return HttpResponse.json({ documents: [newest], nextCursor: 'page-2' })
        await secondPageHeld
        return HttpResponse.json({ documents: [oldest], nextCursor: null })
      }),
    )
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" initialFolders={[]} />,
    )

    expect(await findFileButton(/Neu-Plan\.pdf/)).toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('load-more-button'))
    await waitFor(() => expect(cursors).toEqual([null, 'page-2']))
    expect(screen.queryByTestId('file-browser-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('load-more')).toBeInTheDocument()

    releaseSecondPage()
    expect(await findFileButton(/EG\.pdf/)).toBeInTheDocument()
    expect(await findFileButton(/Neu-Plan\.pdf/)).toBeInTheDocument()
  })

  it('continues a first-page seed from its cursor, and a dropped folder still knows the old file', async () => {
    probeShelf = [newest, oldest]
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[newest]}
        initialNextCursor="page-2"
        initialFolders={[]}
      />,
    )
    expect(await findFileButton(/Neu-Plan\.pdf/)).toBeInTheDocument()
    expect(screen.queryByTestId('file-browser-skeleton')).not.toBeInTheDocument()
    expect(cursors).toEqual([])

    fireEvent.click(await screen.findByTestId('load-more-button'))
    expect(await findFileButton(/EG\.pdf/)).toBeInTheDocument()
    expect(cursors).toEqual(['page-2'])

    const file = new File(['x'.repeat(10)], 'EG.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Wohnbau/EG.pdf', configurable: true })
    const input = screen.getByTestId('project-upload-folder-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(within(dialog).getByTestId('folder-upload-count-update')).toHaveTextContent('1'))
    expect(within(dialog).getByTestId('folder-upload-count-new')).toHaveTextContent('0')
  })

  it('opens a document a link names that no loaded page holds, by its id', async () => {
    server.use(
      http.get('/api/documents/:id', ({ params }) =>
        params.id === 'doc-old' ? HttpResponse.json({ document: oldest }) : new HttpResponse(null, { status: 404 }),
      ),
    )
    searchParams = new URLSearchParams('doc=doc-old')
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[newest]}
        initialNextCursor="page-2"
        initialFolders={[]}
      />,
    )

    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-old'))
    expect(cursors).toEqual([])
  })

  it('drains the shelf only for a filter the server cannot answer, and says where the drain stopped', async () => {
    let requests = 0
    server.use(
      http.get('/api/documents', ({ request }) => {
        if (new URL(request.url).searchParams.has('sort')) {
          return HttpResponse.json({ documents: [newest], nextCursor: null })
        }
        requests += 1
        return HttpResponse.json({ documents: [row(`doc-${requests}`, `plan-${requests}.pdf`)], nextCursor: `c${requests}` })
      }),
    )
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    expect(await findFileButton(/Neu-Plan\.pdf/)).toBeInTheDocument()
    expect(requests).toBe(0)

    await userEvent.click(screen.getByTestId('file-filter-menu-trigger'))
    await userEvent.click(await screen.findByRole('radio', { name: /^status$/i }))

    expect(await screen.findByText(/showing the newest 20 documents/i)).toBeInTheDocument()
    expect(requests).toBe(20)
  })
})
