import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { FilePreviewPane } from './file-preview-pane'
import { DocumentReviewControls } from './document-review-controls'
import type { DocumentVersionListResponse } from '@/lib/documents/lifecycle-types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects/proj-1/files',
  useSearchParams: () => new URLSearchParams(),
}))

const file = {
  id: 'doc-1',
  filename: 'Brandschutzkonzept.pdf',
  displayName: null,
  fileSize: 1_048_576,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: ['Grundriss'],
  topics: null,
  capture: null,
}

const listing: DocumentVersionListResponse = {
  documentId: 'doc-1',
  lifecycle: 'active',
  publishedVersionId: null,
  versions: [
    {
      id: 'ver_1',
      documentId: 'doc-1',
      versionNumber: 1,
      state: 'in_review',
      contentType: 'text/markdown',
      fileSize: 18_400,
      contentHash: 'sha256:1',
      submittedBy: 'u-2',
      submittedAt: '2026-09-03T10:15:00.000Z',
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      publishedBy: null,
      publishedAt: null,
      reviewComment: null,
      createdBy: 'u-2',
      createdAt: '2026-09-02T07:30:00.000Z',
      updatedAt: '2026-09-03T10:15:00.000Z',
    },
  ],
}

const renderPane = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/versions/reviewers')) return Response.json({ candidates: [] })
      if (url.endsWith('/versions')) return Response.json(listing)
      return Response.json({})
    })
  )
  return render(
    <FilePreviewPane
      file={file}
      projectId="proj-1"
      projectName="Wohnbau Nord"
      canCollaborate
      lifecyclePermissions={['project:view', 'project:edit', 'project:documents:write']}
      viewerUserId="u-1"
    />
  )
}

describe('the review rail is a column on a wide container and a stacked block on a phone', () => {
  it('mounts at all when the surface passes lifecycle permissions', async () => {
    renderPane()
    expect(await screen.findByTestId('document-revisions')).toBeInTheDocument()
  })

  it('the rail is full width by default and only becomes a 280px column at @2xl', async () => {
    const { container } = renderPane()
    await screen.findByTestId('document-revisions')

    const rail = container.querySelector('[data-testid="document-revisions"]')
      ?.parentElement as HTMLElement
    expect(rail).toBeTruthy()
    const cls = rail.className
    expect(cls).toContain('w-full')
    expect(cls).toContain('@2xl:w-[280px]')
    expect(cls).toContain('@2xl:shrink-0')
    expect(cls).toContain('@2xl:overflow-y-auto')
    expect(cls).toContain('bg-desk')
    expect(cls).not.toMatch(/\bborder-[tl]\b/)
    expect(container.querySelector('.\\@container')).toBeTruthy()
  })

  it('the body stacks vertically and only becomes a row at @2xl', async () => {
    const { container } = renderPane()
    await screen.findByTestId('document-revisions')

    const rail = container.querySelector('[data-testid="document-revisions"]')
      ?.parentElement as HTMLElement
    const body = rail.parentElement as HTMLElement
    expect(body.className).toContain('flex-col')
    expect(body.className).toContain('@2xl:flex-row')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('@2xl:overflow-hidden')
  })

  it('the header carries no type chip, so nothing runs under the header controls', async () => {
    const { container } = renderPane()
    await screen.findByTestId('document-revisions')
    const nameColumn = container.querySelector('h3')?.parentElement as HTMLElement
    expect(within(nameColumn).queryByText('Grundriss')).toBeNull()
    expect(container.querySelector('.truncate')).toBeTruthy()
  })
})

describe('the review controls wrap, and the comment box takes the whole width', () => {
  const version = listing.versions[0]!
  const viewer = {
    permissions: ['project:view', 'project:edit', 'project:documents:write'] as const,
    userId: 'u-1',
  }

  it('the decisions wrap into rows rather than a squeezed line', () => {
    const { container } = render(
      <DocumentReviewControls
        version={version}
        lifecycle="active"
        viewer={viewer}
        onAct={() => undefined}
      />
    )
    const row = container.querySelector('[data-testid="document-review-controls"] > div')
    expect(row?.className).toContain('flex-wrap')
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('data-testid'))).toEqual([
      'document-lifecycle-approve',
      'document-lifecycle-request_changes',
      'document-review-more',
    ])
  })

  it('the comment box is a full-width block under the controls, not beside them', async () => {
    render(
      <DocumentReviewControls
        version={version}
        lifecycle="active"
        viewer={viewer}
        onAct={() => undefined}
      />
    )
    screen.getByTestId('document-lifecycle-request_changes').click()
    const box = await waitFor(() => screen.getByTestId('document-review-comment'))
    expect(box.parentElement?.className).toContain('space-y-2')
    expect(box.className).not.toContain('absolute')
    expect(box.className).not.toContain('fixed')
    const textarea = screen.getByRole('textbox')
    expect(textarea.className).toContain('w-full')
  })
})
