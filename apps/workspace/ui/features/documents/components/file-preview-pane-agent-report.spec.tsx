import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FilePreviewPane } from './file-preview-pane'
import { PRODUCT_NAME } from '@/lib/brand'

describe('FilePreviewPane — a report the agent wrote', () => {
  const generated = {
    id: 'doc-9',
    filename: 'Tiefenrecherche_Brandschutz.pdf',
    displayName: null,
    fileSize: 1048576,
    contentType: 'application/pdf',
    status: 'stored',
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
    authoredBy: 'agent' as const,
  }

  it('leads the rail with the byline, clear of the assignment row', () => {
    render(<FilePreviewPane file={generated} projectId="proj-1" canCollaborate />)

    const byline = screen.getByText(`Created by ${PRODUCT_NAME}`)
    expect(byline.tagName).toBe('P')
    const identity = byline.parentElement
    expect(identity?.firstElementChild).toBe(byline)
    expect(identity?.textContent).toMatch(/Responsible/)
    expect(within(identity!).queryByText('Filed')).toBeNull()
    expect(screen.getAllByText('Filed')).toHaveLength(1)
  })

  it('drops the read-by section, which would be a false claim', () => {
    render(<FilePreviewPane file={generated} projectId="proj-1" showMetadataPanel />)

    expect(screen.queryByText(`Read by ${PRODUCT_NAME}`)).not.toBeInTheDocument()
    expect(screen.getByTestId('file-preview-facts')).toHaveTextContent('PDF')
  })

  it('offers Besprechen and still says the report is not in the knowledge base', async () => {
    render(<FilePreviewPane file={generated} projectId="proj-1" />)

    const discuss = screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })
    expect(discuss).toBeEnabled()
    expect(discuss).toHaveAttribute('title', `Created by ${PRODUCT_NAME} — not in the knowledge base`)
  })

  it('calls a published agent document what it is: in the knowledge base', () => {
    render(<FilePreviewPane file={{ ...generated, status: 'completed' }} projectId="proj-1" />)

    const discuss = screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })
    expect(discuss).not.toHaveAttribute('title', `Created by ${PRODUCT_NAME} — not in the knowledge base`)
  })

  it('names the agent only for a document the agent wrote', () => {
    render(<FilePreviewPane file={{ ...generated, authoredBy: 'user', status: 'stored' }} projectId="proj-1" />)

    const discuss = screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })
    expect(discuss).not.toHaveAttribute('title', `Created by ${PRODUCT_NAME} — not in the knowledge base`)
  })

  it('says nothing extra about a document that is simply still being read', () => {
    render(
      <FilePreviewPane
        file={{ ...generated, status: 'processing', authoredBy: 'user' }}
        projectId="proj-1"
      />
    )

    const discuss = screen.getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })
    expect(discuss).toBeEnabled()
    expect(discuss).not.toHaveAttribute('title')
  })
})
