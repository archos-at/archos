import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { shelfGet } from '@/test-utils/shelf-handlers'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { buildFolderBrief, emptyTally } from '../lib/folder-knowledge'
import type { FileItem, FolderItem } from '../file-types'
import { everythingRead } from './folder-brief'
import { FolderBrief } from './folder-brief'
import { AssignmentFaces } from './assignment-faces'
import { OfficeShelfWorkspace } from './office-shelf-workspace'
import { ProjectFileWorkspace } from './project-file-workspace'
import { renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'

const onPhone = (phone: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

let seq = 0
const file = (overrides: Partial<FileItem>): FileItem => ({
  id: `f${(seq += 1)}`,
  filename: 'doc.pdf',
  displayName: null,
  fileSize: 1,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: 'P',
  createdAt: '2026-01-01T00:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
  ...overrides,
})

const FOLDERS: FolderItem[] = [{ id: 'P', parentId: null, name: 'Pläne', path: 'Pläne' }]

const DOCUMENT = {
  id: 'doc-1',
  folderId: null,
  filename: 'brandschutz-gutachten.pdf',
  fileSize: 2048,
  contentType: 'application/pdf',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00Z',
  errorMessage: null,
  summary: null,
  tags: ['Brandschutz'],
  pageCount: null,
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'reading'),
    dismiss: vi.fn(),
  },
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

vi.mock('../hooks/use-office-shelf-documents', () => ({
  useOfficeShelfDocuments: vi.fn().mockImplementation(() => ({
    uploadFiles: mockUploadFiles,
    cancelUpload: vi.fn(),
    retryFile: vi.fn(),
    trackedFiles: [],
    isUploading: false,
    isPolling: false,
    error: null,
    clearError: vi.fn(),
  })),
}))

vi.mock('@/features/bim/components/ifc-file-preview', () => ({
  IfcFilePreview: () => <div data-testid="ifc-file-preview" />,
}))

vi.mock('@/features/knowledge/components/pdf-viewer-dialog', () => ({
  PdfViewerDialog: () => null,
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

const briefProps = (files: FileItem[]): ComponentProps<typeof FolderBrief> => ({
  brief: buildFolderBrief(files, FOLDERS, null),
  folderName: null,
  shelfKind: 'project',
  onSelect: vi.fn(),
  onOpenFolder: vi.fn(),
  onReadAgain: vi.fn(),
  collapsed: false,
  onCollapsedChange: vi.fn(),
  missing: [],
})

beforeEach(() => {
  searchParams = new URLSearchParams()
  server.use(
    http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    http.get('/api/office-shelf/folders', () => HttpResponse.json({ folders: [] })),
    shelfGet('project', '/api/documents', () => HttpResponse.json({ documents: [DOCUMENT] })),
    shelfGet('office_shelf', '/api/documents', () =>
      HttpResponse.json({ documents: [DOCUMENT], collectionName: 'archiv_org-1', canManage: true })
    )
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const listOf = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`no element matches ${selector}`)
  return element
}

describe('Dateien on a phone', () => {
  it('the folder disclosure has nothing to say when everything is read', () => {
    const read = { ...emptyTally(), total: 2, readable: 2 }
    expect(everythingRead(read)).toBe(true)
    expect(everythingRead({ ...read, readable: 1, reading: 1 })).toBe(false)
    expect(everythingRead({ ...read, readable: 1, failed: 1 })).toBe(false)
    expect(everythingRead({ ...read, readable: 1, held: 1 })).toBe(false)
    expect(everythingRead({ ...read, total: 3, unindexed: 1 })).toBe(true)
  })

  it('the brief’s read line stands on a phone at every level, as at desk width', () => {
    const readAll = [file({ tags: ['Grundriss'] }), file({ tags: ['Schnitt'] })]
    for (const phone of [true, false]) {
      onPhone(phone)
      const { unmount } = render(<FolderBrief {...briefProps(readAll)} />)
      expect(screen.getByTestId('folder-brief-toggle')).toHaveTextContent(/All 2 documents read/)
      unmount()
    }
  })

  it('the list ends 6rem above the floor so the last row scrolls clear of the floating Hochladen', async () => {
    onPhone(true)
    render(<OfficeShelfWorkspace canManage />)
    await waitFor(() => expect(document.querySelector('[data-testid="files-upload-fab"]')).not.toBeNull())
    const list = listOf('.scroll-fade-bottom')
    expect(list.classList).toContain('pb-[calc(6rem+env(safe-area-inset-bottom))]')
    expect(list.classList).not.toContain('pb-24')
    expect(listOf('[data-testid="files-upload-fab"]').classList).toContain('bottom-[max(1rem,env(safe-area-inset-bottom))]')
  })

  it('a project’s list ends 6rem above the floor, and its floating Hochladen sits 1rem above the floor', async () => {
    onPhone(true)
    resetPreviewStore()
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    await waitFor(() => expect(document.querySelector('[data-testid="files-upload-fab"]')).not.toBeNull())
    const list = listOf('.scroll-fade-bottom')
    expect(list.classList).toContain('pb-24')
    expect(listOf('[data-testid="files-upload-fab"]').classList).toContain('bottom-4')
  })

  it('the breadcrumb row pins to the top of the list at every width, on the base surface', async () => {
    window.localStorage.setItem('files.view', 'list')
    server.use(http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: FOLDERS })))
    searchParams = new URLSearchParams('folder=P')
    for (const phone of [true, false]) {
      onPhone(phone)
      resetPreviewStore()
      const { unmount } = renderWorkspace(
        <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
      )
      await waitFor(() => expect(screen.getByTestId('folder-breadcrumb-row')).toBeInTheDocument())
      const row = screen.getByTestId('folder-breadcrumb-row')
      expect(row.classList).toContain('sticky')
      expect(row.classList).toContain('top-0')
      expect(row.classList).toContain('bg-background')
      expect(row.classList).not.toContain('phone:sticky')
      expect(row.parentElement?.closest('.min-h-full')?.classList).toContain('flex-col')
      unmount()
    }
  })

  it('an unassigned card shows a disc on a phone and keeps the word for the wide card and for screen readers', () => {
    render(<AssignmentFaces assignees={[]} />)
    const mark = screen.getByTestId('assignment-unassigned')
    const word = screen.getByText('Unassigned')
    expect(word.className).toContain('phone:sr-only')
    expect(mark.querySelector('[aria-hidden]')?.className).toContain('phone:flex')
  })
})
