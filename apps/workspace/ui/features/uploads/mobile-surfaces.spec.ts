import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { shelfGet } from '@/test-utils/shelf-handlers'
import { FIXTURE_USER_ID, HISTORY } from '@/app/dev/_fixtures/upload-batches'
import type { MailImportView } from '@/lib/mail-import/types'
import type { TrackedFile } from '@/features/documents/types'
import type { UseMailImports } from '@/features/documents/hooks/use-mail-imports'
import { MailImportDialogView } from '@/features/documents/components/mail-import-dialog'
import { OfficeShelfWorkspace } from '@/features/documents/components/office-shelf-workspace'
import { UploadTray } from '@/features/documents/components/upload-tray'
import { UploadHistoryList } from '@/features/uploads/components/upload-history'

const classesOf = (text: string): string[] => text.split(/\s+/).filter(Boolean)

const LONG_NAME = 'Brandschutzkonzept-Gesamtfassade-Revision-Ostseite-final-2026.pdf'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/office-shelf',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/features/documents/hooks/use-office-shelf-documents', () => ({
  useOfficeShelfDocuments: () => ({
    uploadFiles: vi.fn(),
    cancelUpload: vi.fn(),
    retryFile: vi.fn(),
    trackedFiles: [],
    isUploading: false,
    isPolling: false,
    error: null,
    clearError: vi.fn(),
  }),
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

vi.mock('@/features/documents/orchestrator', () => ({
  UploadOrchestrator: { watchDocuments: vi.fn() },
}))

vi.mock('@/adapters/api/upload-screening-client', () => ({
  requestQuarantineRelease: vi.fn(async () => ({ notified: 1 })),
  getQuarantineReviewAccess: vi.fn(async () => ({ canReview: false, canAskForReview: true })),
  releaseQuarantinedDocument: vi.fn(async () => ({ status: 'processing' })),
}))

describe('Archiv header', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/office-shelf/folders', () => HttpResponse.json({ folders: [] })),
      shelfGet('office_shelf', '/api/documents', () =>
        HttpResponse.json({ documents: [], collectionName: 'archiv_org-1', canManage: true }),
      ),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('lets the controls group shrink to the card instead of keeping its single-line width', async () => {
    render(createElement(OfficeShelfWorkspace, { canManage: true }))
    const controls = await screen.findByTestId('office-shelf-controls')
    expect(classesOf(controls.className)).toContain('min-w-0')
    expect(classesOf(controls.className)).not.toContain('shrink-0')
  })

  it('puts the controls in a row of their own under the title, at every width', async () => {
    render(createElement(OfficeShelfWorkspace, { canManage: true }))
    const header = await screen.findByTestId('office-shelf-header')
    const title = within(header).getByRole('heading', { level: 1 })
    const controls = within(header).getByTestId('office-shelf-controls')
    expect(title.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const toolRow = controls.parentElement as HTMLElement
    expect(toolRow.parentElement).toBe(header)
    expect(toolRow.contains(title)).toBe(false)
    const utilitiesOf = (element: Element): string[] => [...element.classList].map((name) => name.split(':').at(-1) ?? '')
    expect(utilitiesOf(header).filter((name) => /^(inline-)?(flex|grid)$|^inline(-block)?$|^contents$/.test(name))).toEqual([])
    expect(utilitiesOf(toolRow).filter((name) => /^inline(-\w+)?$|^contents$/.test(name))).toEqual([])
    expect(classesOf(toolRow.className)).toContain('flex')
  })
})

describe('upload tray rows', () => {
  const tracked: TrackedFile = {
    id: 'f1',
    fileName: LONG_NAME,
    fileSize: 4_000_000,
    status: 'uploading',
    progress: 0,
    collectionName: 'proj-1',
  } as TrackedFile

  beforeEach(() => {
    render(createElement(UploadTray, { files: [tracked], onRetry: vi.fn() }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the end of a file name', () => {
    const row = screen.getByTestId('upload-row')
    const tail = row.querySelector('[data-part="tail"]')
    expect(tail).not.toBeNull()
    const tailText = tail?.textContent ?? ''
    expect(tailText.length).toBeGreaterThan(0)
    expect(LONG_NAME.endsWith(tailText)).toBe(true)
  })

  it('draws no text under 12px outside the shared extension chip', () => {
    const sizes = [...document.querySelectorAll<HTMLElement>('[class]')]
      .filter((el) => !el.closest('[data-testid="file-ext-chip"]'))
      .flatMap((el) => [...el.classList])
      .map((name) => /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
    expect(sizes.filter((size) => size < 12)).toEqual([])
  })

  it('uses the shared extension chip, at its extra-small size', () => {
    const chip = within(screen.getByTestId('upload-row')).getByTestId('file-ext-chip')
    expect(classesOf(chip.className)).toContain('size-7')
  })
})

describe('mail import rows', () => {
  it('wraps the actions under the text on a phone, so the name keeps its width', () => {
    const row: MailImportView = {
      id: 'imp-1',
      filename: 'Korrespondenz.mbox',
      sizeBytes: 2048,
      status: 'completed',
      startedBy: { userId: FIXTURE_USER_ID, email: null },
      ownedByViewer: true,
      cancellable: false,
      folderId: null,
      totalItems: 3,
      processedItems: 3,
      mailsFiled: 3,
      filesFiled: 0,
      itemsSkipped: 0,
      filesSkipped: 0,
      threadsCreated: 1,
      threadsAppended: 0,
      alreadyInProject: 0,
      skippedSamples: [],
      errorCode: null,
      error: null,
      createdAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:05:00.000Z',
    }
    const state: UseMailImports = {
      list: { imports: [row], nextCursor: null, maxSizeBytes: 1_000_000_000, partSize: 1_000_000 },
      loadError: false,
      sending: null,
      sendError: null,
      cancelError: false,
      start: async () => {},
      resume: async () => {},
      cancel: async () => true,
      dismissErrors: () => {},
    }
    render(
      createElement(MailImportDialogView, {
        projectId: 'project-1',
        open: true,
        onOpenChange: vi.fn(),
        state,
      }),
    )

    const item = screen.getByTestId('mail-import-row')
    expect(classesOf(item.className)).toContain('flex-wrap')
    const actions = item.querySelector<HTMLElement>('[data-slot="item-actions"]')
    expect(actions).not.toBeNull()
    expect(classesOf(actions!.className)).toContain('max-sm:basis-full')
  })
})

describe('upload history rows', () => {
  it('keeps the summary link inside the content, so the pills get the whole row', () => {
    render(createElement(UploadHistoryList, { uploads: HISTORY, currentUserId: FIXTURE_USER_ID }))
    for (const entry of HISTORY) {
      const row = screen.getByTestId(`upload-history-row-${entry.id}`)
      expect(row.querySelector('[data-slot="item-actions"]')).toBeNull()
    }
    const own = screen.getByTestId(`upload-history-open-${HISTORY[0].id}`)
    expect(own.closest('[data-slot="item-content"]')).not.toBeNull()
  })
})
