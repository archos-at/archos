import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { strToU8, zipSync } from 'fflate'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import type { DocumentWireRow } from '../lib/file-item'
import { SUGGESTED_SCREENING_POLICY } from '@/lib/upload-screening/policy'
import { projectScreeningBody } from '@/mocks/handlers/upload-screening'
import { existing, renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'

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

describe('ProjectFileWorkspace — a dropped folder', () => {
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
