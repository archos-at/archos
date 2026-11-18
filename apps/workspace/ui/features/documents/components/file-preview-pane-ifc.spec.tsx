import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilePreviewPane } from './file-preview-pane'
import { mockFile } from './file-preview-pane.fixtures'

vi.mock('@/features/bim/components/ifc-file-preview', () => ({
  IfcFilePreview: (props: { documentId: string; filename: string; projectId: string }) => (
    <div
      data-testid="ifc-file-preview"
      data-document={props.documentId}
      data-filename={props.filename}
      data-project={props.projectId}
    />
  ),
}))

describe('FilePreviewPane', () => {
  describe('an .ifc previews as the building', () => {
    const modelFile = {
      ...mockFile,
      id: 'doc-ifc',
      filename: 'Haus-A.ifc',
      displayName: null,
      contentType: 'application/octet-stream',
    }

    it('renders the model viewport instead of the "no inline preview" mock', async () => {
      render(<FilePreviewPane file={modelFile} projectId="proj-1" />)

      const preview = await screen.findByTestId('ifc-file-preview')
      expect(preview.dataset.document).toBe('doc-ifc')
      expect(preview.dataset.filename).toBe('Haus-A.ifc')
      expect(preview.dataset.project).toBe('proj-1')
      expect(screen.queryByText(/no inline preview/i)).toBeNull()
    })

    it('reads the format from the NAME, not from a tag a model may carry', async () => {
      render(
        <FilePreviewPane
          file={{ ...modelFile, filename: 'Grundriss EG.ifc', tags: ['Grundriss'] }}
          projectId="proj-1"
        />
      )
      expect(await screen.findByTestId('ifc-file-preview')).toBeDefined()
    })

    it('previews the building in the org Archiv too, which has no project', async () => {
      render(<FilePreviewPane file={modelFile} />)

      const preview = await screen.findByTestId('ifc-file-preview')
      expect(preview.dataset.document).toBe('doc-ifc')
      expect(preview.dataset.project).toBeUndefined()
      expect(screen.queryByText(/no inline preview/i)).toBeNull()
    })

    it('never routes an ordinary document to the viewport', () => {
      render(<FilePreviewPane file={mockFile} projectId="proj-1" />)
      expect(screen.queryByTestId('ifc-file-preview')).toBeNull()
    })
  })
})
