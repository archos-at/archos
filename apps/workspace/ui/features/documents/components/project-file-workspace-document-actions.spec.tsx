import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
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
