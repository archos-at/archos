import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { type ReactElement, type ReactNode } from 'react'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { strToU8, zipSync } from 'fflate'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import { FilePreviewHost } from './file-preview-host'
import { SETTLING_POLL_MS } from '../hooks/use-settling-refresh'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { useProjectDocuments } from '../hooks/use-project-documents'
import type { DocumentWireRow } from '../lib/file-item'
import { handOverDroppedFiles, takeDroppedFiles } from '../lib/dropped-file-handover'
import { SUGGESTED_SCREENING_POLICY } from '@/lib/upload-screening/policy'
import { projectScreeningBody } from '@/mocks/handlers/upload-screening'
import { PRODUCT_NAME } from '@/lib/brand'

function renderWorkspace(ui: ReactElement) {
  return render(
    <>
      {ui}
      <FilePreviewHost />
    </>,
  )
}

function findFileButton(name: RegExp) {
  return screen.findByRole('button', {
    name: (accessibleName) => name.test(accessibleName) && !/file actions/i.test(accessibleName),
  })
}

function resetPreviewStore() {
  useFilePreviewStore.setState({
    file: null,
    mode: 'modal',
    hidden: false,
    peekWidth: 320,
    context: {},
  })
}

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

function makeDataTransfer(files: File[]) {
  return {
    items: files.map((f) => ({ kind: 'file', type: f.type })),
    files,
    types: ['Files'],
  }
}

describe('ProjectFileWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  it('renders the file workspace with view controls and upload', () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeDefined()
    expect(screen.getByTestId('project-upload-input')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Test' })).toBeNull()
  })

  it('offers no upload where the reader may only read (ADR-0088), and says so to a dropped file instead of taking it', async () => {
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFolders={[]}
        initialRootAccess="read"
      />,
    )
    expect(screen.queryByTestId('project-upload-input')).toBeNull()
    const dataTransfer = makeDataTransfer([new File(['x'], 'plan.pdf', { type: 'application/pdf' })])
    const zone = screen.getByTestId('workspace-dropzone')
    fireEvent.dragEnter(zone, { dataTransfer })
    const overlay = screen.getByTestId('workspace-drop-overlay')
    expect(overlay).toHaveAttribute('data-refused')
    expect(overlay).toHaveTextContent(/read only/i)

    fireEvent.drop(zone, { dataTransfer })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockUploadFiles).not.toHaveBeenCalled()
    expect(screen.queryByTestId('workspace-drop-overlay')).toBeNull()
  })

  it('shows the drop overlay on dragover of a supported file', () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    const dropzone = screen.getByTestId('workspace-dropzone')
    const dataTransfer = makeDataTransfer([
      new File(['x'], 'plan.pdf', { type: 'application/pdf' }),
    ])

    fireEvent.dragEnter(dropzone, { dataTransfer })

    expect(screen.getByTestId('workspace-drop-overlay')).toBeInTheDocument()
    expect(screen.getByText(/drop files to upload/i)).toBeInTheDocument()
  })

  it('routes a dropped file into the existing upload path (uploadFiles)', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    const dropzone = screen.getByTestId('workspace-dropzone')
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    const dataTransfer = makeDataTransfer([file])

    fireEvent.dragEnter(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    expect(mockUploadFiles).toHaveBeenCalledWith([file], expect.objectContaining({ folderPathFor: expect.any(Function) }))
    expect(screen.queryByTestId('workspace-drop-overlay')).not.toBeInTheDocument()
  })

  it('flags an unsupported drag but still defers rejection to uploadFiles, like the button', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    const dropzone = screen.getByTestId('workspace-dropzone')
    const badFile = new File(['x'], 'photo.png', { type: 'image/png' })
    const dataTransfer = makeDataTransfer([badFile])

    fireEvent.dragEnter(dropzone, { dataTransfer })
    expect(screen.getByText(/not a supported type/i)).toBeInTheDocument()

    fireEvent.drop(dropzone, { dataTransfer })
    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([badFile], expect.objectContaining({ folderPathFor: expect.any(Function) })))
  })

  it('uploads a drop made elsewhere in the project once it arrives, and only once', async () => {
    server.use(http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })))
    takeDroppedFiles('proj-1')
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    handOverDroppedFiles('proj-1', [file])

    const { unmount } = renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([file], expect.objectContaining({ folderPathFor: expect.any(Function) })))
    unmount()
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockUploadFiles).toHaveBeenCalledTimes(1)
  })

  it('holds a handed-over drop while the folders it is planned against failed to load', async () => {
    server.use(http.get('/api/projects/:projectId/folders', () => new HttpResponse(null, { status: 500 })))
    takeDroppedFiles('proj-1')
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    handOverDroppedFiles('proj-1', [file])

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    await waitFor(() => expect(screen.getByText(/folders/i)).toBeInTheDocument())
    expect(mockUploadFiles).not.toHaveBeenCalled()
    expect(takeDroppedFiles('proj-1')).toEqual([file])
  })
})

describe('ProjectFileWorkspace — the mail import action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  const workspace = (rootAccess?: 'read' | 'write') => (
    <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" mailImportEnabled initialRootAccess={rootAccess} />
  )

  it('offers the import to a reader who may write at the project root, where it files its folder', () => {
    renderWorkspace(workspace('write'))
    expect(screen.getByTestId('mail-import-trigger')).toBeDefined()
  })

  it('hides it from a reader whose root access is read (ADR-0088)', () => {
    renderWorkspace(workspace('read'))
    expect(screen.queryByTestId('mail-import-trigger')).toBeNull()
  })
})

describe('ProjectFileWorkspace — a dropped folder', () => {
  const existing: DocumentWireRow = {
    id: 'doc-eg',
    filename: 'EG.pdf',
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
  }

  function pathed(relativePath: string, size = 10): File {
    const name = relativePath.split('/').pop()!
    const file = new File(['x'.repeat(size)], name, { type: 'application/pdf' })
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true })
    return file
  }

  let ensureRequests: Array<{ parentId: string | null; paths: string[] }>
  let moveRequests: Array<{ documentId: string; folderId: string | null }>

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    ensureRequests = []
    moveRequests = []
    server.use(
      http.get('/api/documents', () => HttpResponse.json({ documents: [] })),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.post('/api/projects/:projectId/folders/ensure', async ({ request }) => {
        const body = (await request.json()) as { parentId: string | null; paths: string[] }
        ensureRequests.push(body)
        return HttpResponse.json({
          folders: [],
          folderIdByPath: Object.fromEntries(body.paths.map((path) => [path, `folder-for-${path}`])),
        })
      }),
      http.patch('/api/documents/:id/folder', async ({ params, request }) => {
        const body = (await request.json()) as { folderId: string | null }
        moveRequests.push({ documentId: String(params.id), folderId: body.folderId })
        return HttpResponse.json({ id: params.id })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithCorpus(
    files: DocumentWireRow[] = [existing],
    folders: Array<{ id: string; parentId: string | null; name: string; path: string }> = [],
  ) {
    probeShelf = files
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={files}
        initialFolders={folders}
      />,
    )
  }

  async function dropFolder(files: File[]) {
    const input = screen.getByTestId('project-upload-folder-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    fireEvent.change(input)
    return screen.findByTestId('folder-upload-dialog')
  }

  it('asks before it touches anything, and says what it is about to do', async () => {
    renderWithCorpus()
    await dropFolder([pathed('Wohnbau/Plaene/EG.pdf'), pathed('Wohnbau/Plaene/OG.pdf')])

    expect(mockUploadFiles).not.toHaveBeenCalled()

    const dialog = await screen.findByTestId('folder-upload-dialog')
    expect(within(dialog).getByTestId('folder-upload-count-new')).toHaveTextContent('1')
    expect(within(dialog).getByTestId('folder-upload-count-update')).toHaveTextContent('1')
    expect(within(dialog).getByTestId('folder-upload-count-folders')).toHaveTextContent('2')
  })

  it('creates the tree and files each document into its own folder', async () => {
    renderWithCorpus()
    await dropFolder([pathed('Wohnbau/Plaene/EG.pdf'), pathed('Wohnbau/Statik/Bericht.pdf')])

    await userEvent.click(await screen.findByTestId('folder-upload-confirm'))

    await waitFor(() => expect(ensureRequests).toHaveLength(1))
    expect(ensureRequests[0]).toEqual({
      parentId: null,
      paths: ['Wohnbau', 'Wohnbau/Plaene', 'Wohnbau/Statik'],
    })

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    const [sent, options] = mockUploadFiles.mock.calls[0] as [
      File[],
      { folderIdFor: (file: File) => string | null },
    ]
    expect(sent.map((file) => file.name).sort()).toEqual(['Bericht.pdf', 'EG.pdf'])
    const targets = sent.map((file) => options.folderIdFor(file))
    expect(new Set(targets)).toEqual(
      new Set(['folder-for-Wohnbau/Plaene', 'folder-for-Wohnbau/Statik']),
    )
  })

  it('unpacks a picked zip into the same plan a dropped folder gets', async () => {
    renderWithCorpus()
    const zip = new File(
      [zipSync({ 'Statik/Bericht.pdf': strToU8('%PDF'), 'Statik/Plaene/EG.pdf': strToU8('%PDF') }) as BlobPart],
      'Statik.zip',
      { type: 'application/zip' }
    )
    const input = screen.getByTestId('project-upload-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [zip], configurable: true })
    fireEvent.change(input)

    await userEvent.click(await screen.findByTestId('folder-upload-confirm'))

    await waitFor(() => expect(ensureRequests).toHaveLength(1))
    expect(ensureRequests[0]).toEqual({ parentId: null, paths: ['Statik', 'Statik/Plaene'] })
    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    const [sent, options] = mockUploadFiles.mock.calls[0] as [
      File[],
      { folderIdFor: (file: File) => string | null },
    ]
    expect(sent.map((file) => file.name).sort()).toEqual(['Bericht.pdf', 'EG.pdf'])
    expect(sent.map((file) => options.folderIdFor(file)).sort()).toEqual([
      'folder-for-Statik',
      'folder-for-Statik/Plaene',
    ])
  })

  it('leaves the existing documents alone when the reader unticks the update', async () => {
    renderWithCorpus()
    await dropFolder([pathed('Wohnbau/EG.pdf'), pathed('Wohnbau/New.pdf')])

    const toggle = await screen.findByTestId('folder-upload-include-updates')
    await userEvent.click(within(toggle).getByRole('checkbox'))
    await userEvent.click(screen.getByTestId('folder-upload-confirm'))

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    const [sent] = mockUploadFiles.mock.calls[0] as [File[]]
    expect(sent.map((file) => file.name)).toEqual(['New.pdf'])
  })

  it('sends neither of two files that share a name inside one drop', async () => {
    renderWithCorpus()
    await dropFolder([pathed('W/A/Deckblatt.pdf'), pathed('W/B/Deckblatt.pdf')])

    const dialog = await screen.findByTestId('folder-upload-dialog')
    expect(within(dialog).getByTestId('folder-upload-collisions')).toBeInTheDocument()
    expect(screen.getByTestId('folder-upload-confirm')).toBeDisabled()
  })

  it('uploads nothing when the folders could not be created', async () => {
    server.use(
      http.post('/api/projects/:projectId/folders/ensure', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    )
    renderWithCorpus()
    await dropFolder([pathed('Wohnbau/New.pdf')])

    await userEvent.click(await screen.findByTestId('folder-upload-confirm'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('moves an unchanged document the tree files somewhere else, without uploading', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    renderWithCorpus(
      [{ ...existing, contentHash: digest, folderId: null }],
      [{ id: 'folder-plaene', parentId: null, name: 'Plaene', path: 'Plaene' }],
    )
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    })

    await dropFolder([pathed('Plaene/EG.pdf')])

    const confirm = await screen.findByTestId('folder-upload-confirm')
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.click(confirm)

    await waitFor(() => expect(moveRequests).toHaveLength(1))
    expect(moveRequests[0]).toEqual({ documentId: 'doc-eg', folderId: 'folder-for-Plaene' })
  })

  describe('settled before it is applied', () => {
    const officePolicy = { ...SUGGESTED_SCREENING_POLICY, nameTerms: [...SUGGESTED_SCREENING_POLICY.nameTerms, 'Huber'] }
    const planChanged = 'The preview has changed. Nothing was uploaded. Please review it and confirm again.'

    it('makes no folder named with a term the admin saved while the dialog was open', async () => {
      renderWithCorpus([])
      await dropFolder([pathed('Wohnbau/Huber/Notiz.pdf'), pathed('Wohnbau/New.pdf')])
      const confirm = await screen.findByTestId('folder-upload-confirm')
      await waitFor(() => expect(confirm).toBeEnabled())

      server.use(
        http.get('/api/projects/:projectId/upload-screening', () => HttpResponse.json(projectScreeningBody(officePolicy))),
      )
      await userEvent.click(confirm)

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(planChanged))
      expect(ensureRequests).toEqual([])
      expect(mockUploadFiles).not.toHaveBeenCalled()
      const dialog = screen.getByTestId('folder-upload-dialog')
      expect(within(dialog).getByTestId('folder-upload-excluded')).toHaveTextContent('Wohnbau/Huber/Notiz.pdf')
    })

    it('sends nothing, and says nothing was uploaded, when the office list cannot be read at confirm', async () => {
      renderWithCorpus([])
      await dropFolder([pathed('Wohnbau/New.pdf')])
      const confirm = await screen.findByTestId('folder-upload-confirm')
      await waitFor(() => expect(confirm).toBeEnabled())

      server.use(http.get('/api/projects/:projectId/upload-screening', () => HttpResponse.json({}, { status: 500 })))
      await userEvent.click(confirm)

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          "Your office's list of sensitive data could not be loaded. Nothing was uploaded. Please try again.",
        ),
      )
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(ensureRequests).toEqual([])
      expect(mockUploadFiles).not.toHaveBeenCalled()
    })

    it('waits for a release probe still in flight, and asks again when the file is a version', async () => {
      renderWithCorpus([{ ...existing, id: 'doc-lohn', filename: 'Lohnzettel.pdf' }])
      let answer: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        answer = resolve
      })
      server.use(
        http.post('/api/documents/name-matches', async ({ request }) => {
          const { names } = (await request.clone().json()) as { names: string[] }
          if (names.includes('Lohnzettel.pdf')) await held
        }),
      )
      const dialog = await dropFolder([pathed('Akt/Lohnzettel.pdf'), pathed('Akt/New.pdf')])
      const confirm = await screen.findByTestId('folder-upload-confirm')
      await waitFor(() => expect(confirm).toBeEnabled())

      await userEvent.click(within(dialog).getByTestId('folder-upload-release'))
      await userEvent.click(confirm)
      expect(mockUploadFiles).not.toHaveBeenCalled()

      answer()
      await waitFor(() => expect(toastError).toHaveBeenCalledWith(planChanged))
      expect(mockUploadFiles).not.toHaveBeenCalled()
      expect(ensureRequests).toEqual([])
      expect(within(dialog).getByTestId('folder-upload-count-update')).toHaveTextContent('1')
    })
  })

  it('still takes a handful of picked files straight to the upload path', async () => {
    renderWithCorpus()
    const input = screen.getByTestId('project-upload-input') as HTMLInputElement
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([file], expect.objectContaining({ folderPathFor: expect.any(Function) })))
    expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — a picked file the project already holds', () => {
  const existing: DocumentWireRow = {
    id: 'doc-eg',
    filename: 'EG.pdf',
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
  }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/documents', () => HttpResponse.json({ documents: [existing] })),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithCorpus(files: DocumentWireRow[] = [existing]) {
    probeShelf = files
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={files}
        initialFolders={[]}
      />,
    )
  }

  function pick(file: File) {
    const input = screen.getAllByTestId('project-upload-input')[0] as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
  }

  it('asks „new Fassung of X?" and uploads it on yes', async () => {
    renderWithCorpus()
    const revised = new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' })
    pick(revised)

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    expect(within(dialog).getByText('New revision of “EG.pdf”?')).toBeInTheDocument()
    expect(mockUploadFiles).not.toHaveBeenCalled()

    const confirm = within(dialog).getByTestId('folder-upload-confirm')
    expect(confirm).toHaveTextContent('File as a new revision')
    await userEvent.click(confirm)

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    const [sent, options] = mockUploadFiles.mock.calls[0] as [
      File[],
      { folderIdFor: (file: File) => string | null },
    ]
    expect(sent).toEqual([revised])
    expect(options.folderIdFor(revised)).toBeNull()
  })

  it('sends nothing when the reader cancels', async () => {
    renderWithCorpus()
    pick(new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument())
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('says „unchanged – already here" for identical bytes and uploads nothing', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    renderWithCorpus([{ ...existing, fileSize: 4, contentHash: digest }])
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    })
    pick(new File(['same'], 'EG.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-unchanged'))
    expect(within(dialog).getByText('Unchanged – already here')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('folder-upload-confirm')).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByTestId('folder-upload-close'))
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('compares against the whole shelf while the authorship filter narrows the listing', async () => {
    const searches: string[] = []
    server.use(
      http.get('/api/documents', ({ request }) => {
        const search = new URL(request.url).search
        searches.push(search)
        return HttpResponse.json({ documents: search.includes('authoredBy=agent') ? [] : [existing] })
      }),
    )
    renderWithCorpus()

    await userEvent.click(screen.getByTestId('file-filter-menu-trigger'))
    await userEvent.click(await screen.findByLabelText(`By ${PRODUCT_NAME}`))
    await waitFor(() => expect(searches.at(-1)).toContain('authoredBy=agent'))
    await userEvent.keyboard('{Escape}')

    pick(new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('asks about a same-name document the loaded listing does not hold', async () => {
    renderWithCorpus([])
    probeShelf = [{ ...existing, lifecycle: 'archived' }]
    const revised = new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' })
    pick(revised)

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    expect(probedNames.at(-1)).toEqual(['EG.pdf'])
    expect(within(dialog).getByTestId('folder-upload-archived')).toBeInTheDocument()
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('sends a name the shelf does not hold straight to the upload', async () => {
    renderWithCorpus()
    const fresh = new File(['x'], 'Neu.pdf', { type: 'application/pdf' })
    pick(fresh)

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([fresh], expect.objectContaining({ folderPathFor: expect.any(Function) })))
    expect(probedNames).toEqual([['Neu.pdf']])
    expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument()
  })

  it('says so when the comparison could not be made, and sends nothing', async () => {
    server.use(http.post('/api/documents/name-matches', () => HttpResponse.json({}, { status: 500 })))
    renderWithCorpus()
    pick(new File(['x'], 'EG.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('never asks the server about a name the office list holds back', async () => {
    renderWithCorpus()
    pick(new File(['x'], 'Lohnzettel_Mai_Huber.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(within(dialog).getAllByText(/Lohnzettel_Mai_Huber\.pdf/).length).toBeGreaterThan(0))
    expect(probedNames).toEqual([])
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('sends nothing, not even the name, while the office list cannot be read', async () => {
    server.use(http.get('/api/projects/:projectId/upload-screening', () => HttpResponse.json({}, { status: 500 })))
    renderWithCorpus()
    pick(new File(['x'], 'Notizen.pdf', { type: 'application/pdf' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Your office's list of sensitive data could not be loaded. Nothing was uploaded. Please try again.",
      ),
    )
    expect(probedNames).toEqual([])
    expect(mockUploadFiles).not.toHaveBeenCalled()
    expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument()
  })
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

describe('ProjectFileWorkspace — dragging a file into a folder', () => {
  const dragTransfer = (documentId: string) => {
    const store: Record<string, string> = { 'application/x-document-id': documentId }
    return {
      types: ['application/x-document-id'],
      items: [{ kind: 'string', type: 'application/x-document-id' }],
      getData: (key: string) => store[key] ?? '',
      setData: (key: string, value: string) => {
        store[key] = value
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    server.use(
      http.get('/api/projects/:projectId/folders', () =>
        HttpResponse.json({ folders: [{ id: 'folder-1', name: 'Brandschutz', parentId: null }] })
      ),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-1',
              filename: 'plan.pdf',
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
            },
          ],
        })
      ),
      http.patch('/api/documents/:id/folder', () => HttpResponse.json({ ok: true }))
    )
  })

  it('moves the file through the same endpoint the menu uses', async () => {
    const patched: Array<{ url: string; body: unknown }> = []
    server.use(
      http.patch('/api/documents/:id/folder', async ({ request, params }) => {
        patched.push({ url: String(params.id), body: await request.json() })
        return HttpResponse.json({ ok: true })
      })
    )

    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const folder = await screen.findByTestId('folder-card-folder-1')
    fireEvent.dragOver(folder, { dataTransfer: dragTransfer('doc-1') })
    fireEvent.drop(folder, { dataTransfer: dragTransfer('doc-1') })

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ url: 'doc-1', body: { folderId: 'folder-1' } })
  })

  it('says why when the server refuses an IFC model into a restricted folder (ADR-0087)', async () => {
    server.use(
      http.patch('/api/documents/:id/folder', () =>
        HttpResponse.json(
          { error: 'IFC models cannot be filed in a restricted folder yet', code: 'CONFLICT', details: { code: 'IFC_IN_RESTRICTED_FOLDER', models: 1 } },
          { status: 409 },
        )
      )
    )
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const folder = await screen.findByTestId('folder-card-folder-1')
    fireEvent.dragOver(folder, { dataTransfer: dragTransfer('doc-1') })
    fireEvent.drop(folder, { dataTransfer: dragTransfer('doc-1') })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot be filed in a folder not everyone may read yet'))
    )
  })

  it('does not raise the upload overlay for a drag that started in the page', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const dropzone = screen.getByTestId('workspace-dropzone')
    fireEvent.dragEnter(dropzone, { dataTransfer: dragTransfer('doc-1') })

    expect(screen.queryByTestId('workspace-drop-overlay')).not.toBeInTheDocument()
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('still raises it for a real upload', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const dropzone = screen.getByTestId('workspace-dropzone')
    fireEvent.dragEnter(dropzone, {
      dataTransfer: makeDataTransfer([new File(['x'], 'plan.pdf', { type: 'application/pdf' })]),
    })

    expect(screen.getByTestId('workspace-drop-overlay')).toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — dragging a folder into a folder', () => {
  const folders = [
    { id: 'f-a', name: 'Brandschutz', parentId: null, path: 'Brandschutz' },
    { id: 'f-b', name: 'Statik', parentId: null, path: 'Statik' },
    { id: 'f-a1', name: 'Fluchtwege', parentId: 'f-a', path: 'Brandschutz/Fluchtwege' },
  ]

  const folderDragTransfer = (folderId: string) => {
    const store: Record<string, string> = { 'application/x-grid-folder-id': folderId }
    return {
      types: ['application/x-grid-folder-id', `application/x-grid-folder-id:${folderId}`],
      items: [{ kind: 'string', type: 'application/x-grid-folder-id' }],
      getData: (key: string) => store[key] ?? '',
      setData: (key: string, value: string) => {
        store[key] = value
      },
    }
  }

  let patched: Array<{ url: string; body: unknown }>

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    patched = []
    server.use(
      http.get('/api/documents', () => HttpResponse.json({ documents: [] })),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders })),
      http.patch('/api/projects/:projectId/folders/:folderId', async ({ request, params }) => {
        patched.push({ url: String(params.folderId), body: await request.json() })
        return HttpResponse.json({ folder: { id: params.folderId } })
      }),
    )
  })

  function renderWithFolders() {
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[]}
        initialFolders={folders}
      />,
    )
  }

  it('re-parents the dragged folder', async () => {
    renderWithFolders()
    const target = screen.getByTestId('folder-card-f-b')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ url: 'f-a', body: { parentId: 'f-b' } })
  })

  it('says why when the server refuses moving IFC models under a restriction (ADR-0087)', async () => {
    server.use(
      http.patch('/api/projects/:projectId/folders/:folderId', () =>
        HttpResponse.json(
          { error: 'IFC models cannot be filed in a restricted folder yet', code: 'CONFLICT', details: { code: 'IFC_IN_RESTRICTED_FOLDER', models: 1 } },
          { status: 409 },
        )
      )
    )
    renderWithFolders()
    const target = screen.getByTestId('folder-card-f-b')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot be filed in a folder not everyone may read yet'))
    )
  })

  it('refuses a folder dropped on itself', async () => {
    renderWithFolders()
    const target = screen.getByTestId('folder-card-f-a')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    expect(target).not.toHaveAttribute('data-drop-over')

    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })
    await waitFor(() => expect(patched).toHaveLength(0))
  })

  it('refuses a folder dropped into its own descendant', async () => {
    searchParams = new URLSearchParams('folder=f-a')
    renderWithFolders()
    const target = await screen.findByTestId('folder-card-f-a1')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    expect(target).not.toHaveAttribute('data-drop-over')

    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })
    await waitFor(() => expect(patched).toHaveLength(0))
  })

  it('moves a nested folder back out through the breadcrumb root', async () => {
    searchParams = new URLSearchParams('folder=f-a')
    renderWithFolders()

    const root = await screen.findByRole('button', { name: 'All Files' })
    fireEvent.dragOver(root, { dataTransfer: folderDragTransfer('f-a1') })
    fireEvent.drop(root, { dataTransfer: folderDragTransfer('f-a1') })

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ url: 'f-a1', body: { parentId: null } })
  })
})

describe('ProjectFileWorkspace — mobile preview overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-1',
              filename: 'notes.txt',
              fileSize: 128,
              contentType: 'text/plain',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-01T00:00:00Z',
              errorMessage: null,
            },
          ],
        })
      ),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('renders the preview as a labelled modal dialog and closes on Escape', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const fileRow = await findFileButton(/notes\.txt/i)
    fireEvent.click(fileRow)

    const dialog = await screen.findByRole('dialog', { name: /File preview: notes\.txt/i })
    expect(dialog).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('ProjectFileWorkspace — saved tags survive reselect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-a',
              filename: 'alpha.txt',
              fileSize: 128,
              contentType: 'text/plain',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-01T00:00:00Z',
              errorMessage: null,
              tags: ['Grundriss'],
            },
            {
              id: 'doc-b',
              filename: 'beta.txt',
              fileSize: 256,
              contentType: 'text/plain',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-02T00:00:00Z',
              errorMessage: null,
              tags: [],
            },
          ],
        })
      ),
      http.patch('/api/documents/:id/tags', () => HttpResponse.json({})),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('shows the newly saved tag after switching away and back to the file', async () => {
    const user = userEvent.setup()
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    fireEvent.click(await findFileButton(/alpha\.txt/i))
    await user.click(await screen.findByRole('button', { name: 'Correct' }))
    await user.type(await screen.findByRole('textbox', { name: /add tag/i }), 'Brandschutz{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove tag Fire safety' })).toBeDefined()
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(await findFileButton(/beta\.txt/i))
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(await findFileButton(/alpha\.txt/i))
    await screen.findByRole('dialog')

    await user.click(await screen.findByRole('button', { name: 'Correct' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove tag Fire safety' })).toBeDefined()
    )
    expect(screen.getByRole('button', { name: 'Remove tag Floor plan' })).toBeDefined()
  })
})

describe('ProjectFileWorkspace — renaming and deleting a document', () => {
  const document = {
    id: 'doc-a',
    filename: 'alpha.pdf',
    fileSize: 128,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    errorMessage: null,
    tags: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => HttpResponse.json({ documents: [document] })),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('renames from the preview and shows the new name on the card behind it', async () => {
    server.use(
      http.patch('/api/documents/:id', async ({ request }) => {
        const body = (await request.json()) as { displayName: string | null }
        return HttpResponse.json({ id: 'doc-a', filename: 'alpha.pdf', ...body })
      })
    )
    const user = userEvent.setup()
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    fireEvent.click(await findFileButton(/alpha\.pdf/i))
    const renameDialog = await screen.findByRole('dialog')
    await user.click(within(renameDialog).getByTestId('document-actions-trigger'))
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }))

    const field = await screen.findByLabelText('Name')
    await user.clear(field)
    await user.type(field, 'Einreichplan EG')
    await user.click(screen.getByTestId('rename-submit'))

    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
    expect((await screen.findAllByText('Einreichplan EG.pdf')).length).toBeGreaterThan(0)
  })

  it('deletes through the project route and drops the card', async () => {
    const deleted: string[] = []
    server.use(
      http.delete('/api/documents/:id', ({ params }) => {
        deleted.push(String(params.id))
        return new HttpResponse(null, { status: 204 })
      })
    )
    const user = userEvent.setup()
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    fireEvent.click(await findFileButton(/alpha\.pdf/i))
    const deleteDialog = await screen.findByRole('dialog')
    await user.click(within(deleteDialog).getByTestId('document-actions-trigger'))
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
    await user.click(await screen.findByTestId('document-delete-confirm'))

    await waitFor(() => expect(deleted).toEqual(['doc-a']))
    await waitFor(() => expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument())
  })
})

describe('ProjectFileWorkspace — a settling document settles on screen', () => {
  let documentCalls = 0
  let statusCalls = 0

  const corpus = (status: string, filename = 'Haus-A.ifc') =>
    HttpResponse.json({
      documents: [
        {
          id: 'doc-ifc',
          filename,
          fileSize: 148_900_000,
          contentType: 'application/octet-stream',
          status,
          folderId: null,
          createdAt: '2026-01-01T00:00:00Z',
          errorMessage: null,
        },
      ],
    })

  const statusOf = (status: string, filename = 'Haus-A.ifc') =>
    HttpResponse.json({ id: 'doc-ifc', filename, status })

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    documentCalls = 0
    statusCalls = 0
    resetPreviewStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-asks the settling row by id — not the whole corpus — and stops once it is terminal', async () => {
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing')
      }),
      http.get('/api/documents/:id/status', ({ params }) => {
        statusCalls += 1
        expect(params.id).toBe('doc-ifc')
        return statusOf('ready')
      })
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))
    expect(await screen.findByText('Reading')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(4_100)
    await waitFor(() => expect(statusCalls).toBe(1))
    await waitFor(() => expect(screen.queryByText('Reading')).not.toBeInTheDocument())
    expect(documentCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(12_000)
    expect(statusCalls).toBe(1)
    expect(documentCalls).toBe(1)
  })

  it('keeps at most one poll in flight, however slow the endpoint is', async () => {
    let inFlight = 0
    let peak = 0
    const gate: { release: (() => void) | null } = { release: null }
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing')
      }),
      http.get('/api/documents/:id/status', async () => {
        statusCalls += 1
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise<void>((resolve) => (gate.release = resolve))
        inFlight -= 1
        return statusOf('processing')
      })
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))

    await vi.advanceTimersByTimeAsync(13_000)
    expect(statusCalls).toBe(1)
    expect(peak).toBe(1)

    gate.release?.()
  })

  it('tells the user what became possible — a building is asked, not cited', async () => {
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing')
      }),
      http.get('/api/documents/:id/status', () => statusOf('ready'))
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))
    await vi.advanceTimersByTimeAsync(4_100)

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/you can now ask about the building/i),
        expect.anything()
      )
    )
  })

  it('keeps the ordinary wording for an ordinary document', async () => {
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing', 'Bescheid.pdf')
      }),
      http.get('/api/documents/:id/status', () => statusOf('ready', 'Bescheid.pdf'))
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))
    await vi.advanceTimersByTimeAsync(4_100)

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/citable/i),
        expect.anything()
      )
    )
  })

  it('reloads quietly, with one stable callback, when an upload finishes on any surface', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', async () => {
        documentCalls += 1
        if (documentCalls > 1) await new Promise<void>((resolve) => (gate.release = resolve))
        return corpus('ready', 'Bescheid.pdf')
      })
    )

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    expect(await findFileButton(/Bescheid\.pdf/)).toBeInTheDocument()

    const onComplete = vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete
    onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(2))
    expect(await findFileButton(/Bescheid\.pdf/)).toBeInTheDocument()

    const callbacks = new Set(vi.mocked(useProjectDocuments).mock.calls.map(([options]) => options?.onComplete))
    expect(callbacks.size).toBe(1)

    gate.release?.()
  })
})

describe('ProjectFileWorkspace — only the newest answer may win', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const corpus = (status: string) =>
    HttpResponse.json({
      documents: [
        {
          id: 'doc-ifc',
          filename: 'Haus-A.ifc',
          fileSize: 148_900_000,
          contentType: 'application/octet-stream',
          status,
          folderId: null,
          createdAt: '2026-01-01T00:00:00Z',
          errorMessage: null,
        },
      ],
    })

  const flushWithoutPolling = async () => {
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(50)
  }

  it('ignores a poll response that resolves after a newer foreground load', async () => {
    let documentCalls = 0
    let statusCalls = 0
    const gate: { release: (() => void) | null } = { release: null }
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus(documentCalls === 1 ? 'processing' : 'ready')
      }),
      http.get('/api/documents/:id/status', async () => {
        statusCalls += 1
        await new Promise<void>((resolve) => (gate.release = resolve))
        return HttpResponse.json({ id: 'doc-ifc', filename: 'Haus-A.ifc', status: 'processing' })
      })
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    expect(await screen.findByText('Reading')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(4_100)
    await waitFor(() => expect(statusCalls).toBe(1))

    const onComplete = vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete
    expect(onComplete).toBeTypeOf('function')
    onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(2))
    await waitFor(() => expect(screen.queryByText('Reading')).not.toBeInTheDocument())

    gate.release?.()
    await flushWithoutPolling()

    expect(screen.queryByText('Reading')).not.toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(8_000)
    expect(statusCalls).toBe(1)
    expect(documentCalls).toBe(2)
  })
})

describe('ProjectFileWorkspace — an .ifc opens as a building', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-model',
              filename: 'Haus-A.ifc',
              fileSize: 149_000_000,
              contentType: 'application/octet-stream',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-01T00:00:00Z',
              errorMessage: null,
            },
            {
              id: 'doc-pdf',
              filename: 'Einreichplan.pdf',
              fileSize: 2048,
              contentType: 'application/pdf',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-02T00:00:00Z',
              errorMessage: null,
            },
          ],
        })
      ),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('opens the preview first, like every other file', async () => {
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        showModels
      />
    )
    fireEvent.click(await findFileButton(/Haus-A\.ifc/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      routerPush.mock.calls.some((call) => String(call[0]).includes('model=Haus-A.ifc'))
    ).toBe(false)
  })

  it('leaves every other file opening the preview dialog', async () => {
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        showModels
      />
    )
    fireEvent.click(await findFileButton(/Einreichplan\.pdf/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('falls back to the ordinary preview when the org has no IFC feature', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )
    fireEvent.click(await findFileButton(/Haus-A\.ifc/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
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

describe('ProjectFileWorkspace — folders are addressable', () => {
  const FOLDERS = [
    { id: 'f-1', name: 'Planung', parentId: null },
    { id: 'f-2', name: 'Statik', parentId: 'f-1' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: FOLDERS })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-in-folder',
              filename: 'Statikbericht.pdf',
              fileSize: 2048,
              contentType: 'application/pdf',
              status: 'ready',
              folderId: 'f-2',
              createdAt: '2026-01-02T00:00:00Z',
              errorMessage: null,
            },
          ],
        })
      )
    )
  })

  const render = () =>
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

  it('opening a folder PUSHES it into the URL, so back means "up one level"', async () => {
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder “Planung”' }))

    const href = String(routerPush.mock.calls.at(-1)?.[0])
    expect(new URLSearchParams(href.split('?')[1]).get('folder')).toBe('f-1')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('reads the level back out of the URL, so a pasted link opens that folder', async () => {
    searchParams = new URLSearchParams('folder=f-2')
    render()

    expect(await screen.findByText(/Statikbericht/)).toBeInTheDocument()
  })

  it('offers a named way up, not just a breadcrumb to aim at', async () => {
    searchParams = new URLSearchParams('folder=f-2')
    render()

    const back = await screen.findByTestId('folder-back')
    expect(back).toHaveTextContent('Planung')

    fireEvent.click(back)
    const href = String(routerPush.mock.calls.at(-1)?.[0])
    expect(new URLSearchParams(href.split('?')[1]).get('folder')).toBe('f-1')
  })

  it('leaves the root with no way up, because there is nowhere to go', async () => {
    render()
    await screen.findByRole('button', { name: 'Open folder “Planung”' })
    expect(screen.queryByTestId('folder-back')).not.toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — the open file is on the URL', () => {
  const doc: DocumentWireRow = {
    id: 'doc-eg',
    filename: 'EG.pdf',
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
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetPreviewStore()
    searchParams = new URLSearchParams()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => HttpResponse.json({ documents: [doc], nextCursor: null })),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderAt(query = '') {
    searchParams = new URLSearchParams(query)
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[doc]}
      />,
    )
  }

  it('names the file it opened, so the link can be handed to somebody', async () => {
    renderAt()
    fireEvent.click(await findFileButton(/EG\.pdf/))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    const href = String(routerPush.mock.calls.at(-1)?.[0])
    expect(new URLSearchParams(href.split('?')[1]).get('doc')).toBe('doc-eg')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('opens the file a link names', async () => {
    renderAt('doc=doc-eg')
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('closes the preview when the reader goes back', async () => {
    const { rerender } = renderAt('doc=doc-eg')
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))

    searchParams = new URLSearchParams()
    rerender(
      <>
        <ProjectFileWorkspace
          projectId="proj-1"
          projectName="Test"
          collectionName="test-coll"
          initialFiles={[doc]}
        />
        <FilePreviewHost />
      </>,
    )

    await waitFor(() => expect(useFilePreviewStore.getState().file).toBeNull())
  })

  it('drops the parameter when the preview is closed by its own control', async () => {
    renderAt('doc=doc-eg')
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))

    useFilePreviewStore.getState().close()

    await waitFor(() => expect(routerReplace).toHaveBeenCalled())
    const href = String(routerReplace.mock.calls.at(-1)?.[0])
    expect(href).not.toContain('doc=')
    await waitFor(() =>
      expect(screen.getByTestId('file-card').querySelector('[aria-current="true"]')).toBeNull(),
    )
  })
  it('brings the open modal along when the listing behind it refreshes', async () => {
    let documentCalls = 0
    server.use(
      http.get('/api/documents', () => {
        documentCalls += 1
        return HttpResponse.json({
          documents: [{ ...doc, status: 'ready', summary: 'Ein Grundriss.', pageCount: 2, tags: ['Grundriss'] }],
        })
      }),
      http.get('/api/documents/:id/status', () =>
        HttpResponse.json({ id: 'doc-eg', filename: 'EG.pdf', status: 'processing', summary: null }),
      ),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
    searchParams = new URLSearchParams('doc=doc-eg')
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[{ ...doc, status: 'processing' }]}
      />,
    )
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))

    vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(1))

    await waitFor(() =>
      expect(useFilePreviewStore.getState().file).toMatchObject({
        status: 'ready',
        summary: 'Ein Grundriss.',
        pageCount: 2,
        tags: ['Grundriss'],
      }),
    )
  })

  it('never moves the open modal back to settling on a stale listing', async () => {
    let documentCalls = 0
    server.use(
      http.get('/api/documents', () => {
        documentCalls += 1
        return HttpResponse.json({ documents: [{ ...doc, status: 'processing' }] })
      }),
      http.get('/api/documents/:id/status', () =>
        HttpResponse.json({ id: 'doc-eg', filename: 'EG.pdf', status: 'ready' }),
      ),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    searchParams = new URLSearchParams('doc=doc-eg')
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[{ ...doc, status: 'processing' }]}
      />,
    )
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))
    await vi.advanceTimersByTimeAsync(SETTLING_POLL_MS)
    await waitFor(() => expect(useFilePreviewStore.getState().file?.status).toBe('ready'))

    vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(1))
    await waitFor(() => expect(screen.getAllByText('Reading').length).toBeGreaterThan(0))

    expect(useFilePreviewStore.getState().file?.status).toBe('ready')
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

describe('ProjectFileWorkspace — Fassungen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  const row = (id: string, filename: string, revision: DocumentWireRow['revision']): DocumentWireRow =>
    ({
      id,
      filename,
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
      authoredBy: 'user',
      revision,
    }) as DocumentWireRow

  it('lists one entry for a document and opens its older Fassung by id from the preview', async () => {
    const older = row('doc-v1', 'Gutachten_v1.pdf', {
      supersededBy: { id: 'doc-v2', filename: 'Gutachten_v2.pdf' },
      supersedes: [],
      suggestion: null,
      changeSummary: null,
    })
    const current = row('doc-v2', 'Gutachten_v2.pdf', {
      supersededBy: null,
      supersedes: [{ id: 'doc-v1', filename: 'Gutachten_v1.pdf' }],
      suggestion: null,
      changeSummary: null,
      history: [{ id: 'doc-v1', filename: 'Gutachten_v1.pdf', createdAt: null, changeSummary: null }],
    })
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[current, older]}
        initialFolders={[]}
      />,
    )

    expect(await findFileButton(/Gutachten_v2\.pdf/)).toBeInTheDocument()
    expect(screen.queryByText('Gutachten_v1.pdf')).not.toBeInTheDocument()

    fireEvent.click(await findFileButton(/Gutachten_v2\.pdf/))
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-v2'))

    act(() => useFilePreviewStore.getState().context.onOpenDocument?.('doc-v1'))
    expect(useFilePreviewStore.getState().file?.id).toBe('doc-v1')
  })

  it('moves BOTH listing entries when the preview confirms a link', async () => {
    const unlinked = { supersededBy: null, supersedes: [], suggestion: null, changeSummary: null }
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[
          row('doc-new', 'Statik_Entwurf.pdf', unlinked),
          row('doc-old', 'Tragwerk_Altstand.pdf', unlinked),
        ]}
        initialFolders={[]}
      />,
    )
    expect(await findFileButton(/Tragwerk_Altstand\.pdf/)).toBeInTheDocument()

    fireEvent.click(await findFileButton(/Statik_Entwurf\.pdf/))
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-new'))

    const { onRevisionChanged } = useFilePreviewStore.getState().context
    act(() => {
      onRevisionChanged?.('doc-new', {
        ...unlinked,
        supersedes: [{ id: 'doc-old', filename: 'Tragwerk_Altstand.pdf' }],
      })
      onRevisionChanged?.('doc-old', {
        ...unlinked,
        supersededBy: { id: 'doc-new', filename: 'Statik_Entwurf.pdf' },
      })
    })

    await waitFor(() => expect(screen.queryByText('Tragwerk_Altstand.pdf')).not.toBeInTheDocument())
    expect(useFilePreviewStore.getState().file?.revision?.supersedes).toEqual([
      { id: 'doc-old', filename: 'Tragwerk_Altstand.pdf' },
    ])
  })
})

async function startPicking(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByTestId('files-more'))
  await user.click(await screen.findByTestId('selection-start'))
}

describe('ProjectFileWorkspace — on a phone', () => {
  const photo = (id: string, filename: string): DocumentWireRow => ({
    id,
    filename,
    displayName: null,
    fileSize: 4_000_000,
    contentType: 'image/jpeg',
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
  const photos = [photo('p1', 'IMG_0001.jpg'), photo('p2', 'IMG_0002.jpg'), photo('p3', 'IMG_0003.jpg')]
  const folders = [{ id: 'f-site', name: 'Baustelle', parentId: null, path: '/Baustelle' }]

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    media.phone = true
    window.localStorage.clear()
    server.use(http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders })))
  })
  afterEach(() => {
    media.phone = false
    window.localStorage.clear()
  })

  const phoneWorkspace = (props: Partial<Parameters<typeof ProjectFileWorkspace>[0]> = {}) => (
    <ProjectFileWorkspace
      projectId="proj-1"
      projectName="Test"
      collectionName="test-coll"
      initialFiles={photos}
      initialFolders={folders}
      {...props}
    />
  )

  it('draws one row of controls: search and filter, the rest behind ⋯', () => {
    renderWorkspace(phoneWorkspace())
    const controls = screen.getByTestId('files-controls')
    expect(within(controls).getByRole('textbox', { name: /search/i })).toBeInTheDocument()
    expect(within(controls).getByTestId('file-filter-menu-trigger')).toBeInTheDocument()
    expect(within(controls).getByTestId('files-more')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull()
    expect(within(controls).queryByTestId('project-upload-input')).toBeNull()
  })

  it('puts the one upload control at the foot of the screen, under the thumb', () => {
    renderWorkspace(phoneWorkspace())
    const fab = screen.getByTestId('files-upload-fab')
    expect(within(fab).getByTestId('project-upload-input')).toBeInTheDocument()
    expect(screen.getAllByTestId('project-upload-input')).toHaveLength(1)
  })

  it('offers the upload nowhere to a reader who may only read', () => {
    renderWorkspace(phoneWorkspace({ initialRootAccess: 'read' }))
    expect(screen.queryByTestId('files-upload-fab')).toBeNull()
  })

  it('keeps the desk’s row where there is room', () => {
    media.phone = false
    renderWorkspace(phoneWorkspace())
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    expect(screen.queryByTestId('files-upload-fab')).toBeNull()
    expect(screen.queryByTestId('files-more')).toBeNull()
  })

  it('moves the Outlook import behind ⋯ instead of a second header button', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace({ mailImportEnabled: true, initialRootAccess: 'write' }))
    expect(screen.queryByTestId('mail-import-trigger')).toBeNull()
    await user.click(screen.getByTestId('files-more'))
    expect(await screen.findByTestId('mail-import-trigger')).toBeInTheDocument()
  })

  it('turns the view with the ⋯ menu', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await user.click(screen.getByTestId('files-more'))
    await user.click(await screen.findByTestId('files-view-list'))
    expect(await screen.findByTestId('file-list-view')).toBeInTheDocument()
  })

  it('files several photos into a folder in one gesture, with one message', async () => {
    const user = userEvent.setup()
    const patched: Array<{ id: string; folderId: unknown }> = []
    server.use(
      http.patch('/api/documents/:id/folder', async ({ request, params }) => {
        patched.push({ id: String(params.id), folderId: ((await request.json()) as { folderId: unknown }).folderId })
        return HttpResponse.json({ ok: true })
      })
    )
    renderWorkspace(phoneWorkspace())

    await startPicking(user)
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument()
    expect(screen.getByTestId('selection-count')).toHaveTextContent('0 selected')
    const cards = screen.getAllByTestId('file-card')
    await user.click(cards[0]!)
    await user.click(cards[1]!)
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected')
    expect(useFilePreviewStore.getState().file).toBeNull()
    expect(screen.queryByTestId('files-upload-fab')).toBeNull()

    await user.click(screen.getByTestId('selection-move'))
    await user.click(await screen.findByTestId('folder-picker-f-site'))

    await waitFor(() => expect(patched).toHaveLength(2))
    expect(patched.every((call) => call.folderId === 'f-site')).toBe(true)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull())
  })

  it('selects every document of the level with „Alle"', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await startPicking(user)
    await user.click(screen.getByTestId('selection-all'))
    expect(screen.getByTestId('selection-count')).toHaveTextContent('3 selected')
  })

  it('ends the selection with „Fertig" and opens files again', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await startPicking(user)
    await user.click(screen.getByTestId('selection-done'))
    expect(screen.queryByTestId('selection-bar')).toBeNull()
    await user.click(screen.getAllByTestId('file-card')[0]!)
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBeDefined())
  })

  it('offers no selection where the reader may only read', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace({ initialRootAccess: 'read' }))
    await user.click(await screen.findByTestId('files-more'))
    expect(screen.queryByTestId('selection-start')).toBeNull()
    expect(screen.queryByTestId('files-new-folder')).toBeNull()
  })

  it('puts „Auswählen“ and „Ordner anlegen“ first in the ⋯ at the root, with no path row above the brief', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await screen.findAllByTestId('file-card')
    expect(screen.queryByTestId('folder-breadcrumb-row')).toBeNull()
    await user.click(screen.getByTestId('files-more'))
    expect(await screen.findByTestId('selection-start')).toBeInTheDocument()
    expect(screen.getByTestId('files-new-folder')).toBeInTheDocument()
  })
})
