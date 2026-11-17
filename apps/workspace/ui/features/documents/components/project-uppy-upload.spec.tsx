import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1e6,
      maxTotalSize: 100 * 1e6,
      maxFileCount: 10,
    },
  }),
}))

import { ProjectUppyUpload } from './project-uppy-upload'

describe('ProjectUppyUpload', () => {
  it('says at the foot of its menu where else files may go, the formats, and the per-file limit in decimal MB', async () => {
    const user = userEvent.setup()
    render(<ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders />)
    await user.click(screen.getByTestId('project-upload-trigger'))
    const note = await screen.findByTestId('project-upload-limits')
    expect(note).toHaveTextContent('Or drop files anywhere on this page.')
    expect(note).toHaveTextContent(/PDF, DOCX, TXT, MD.* · max\. 100 MB per file$/)
  })

  it('is a plain button where folders are not offered', () => {
    render(<ProjectUppyUpload onUpload={vi.fn()} isUploading={false} />)

    expect(screen.queryByTestId('project-upload-folder-item')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('offers files and folders from one button when folders are allowed', async () => {
    const user = userEvent.setup()
    render(<ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders />)

    expect(screen.getAllByRole('button')).toHaveLength(1)

    await user.click(screen.getByTestId('project-upload-trigger'))

    expect(await screen.findByTestId('project-upload-files-item')).toBeInTheDocument()
    expect(screen.getByTestId('project-upload-folder-item')).toBeInTheDocument()
  })

  it('points the folder item at the directory input, not the file one', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders />
    )

    const folderInput = container.querySelector('[data-testid="project-upload-folder-input"]')
    expect(folderInput).toHaveAttribute('webkitdirectory')

    const clicked = vi.fn()
    folderInput?.addEventListener('click', clicked)
    await user.click(screen.getByTestId('project-upload-trigger'))
    await user.click(screen.getByTestId('project-upload-folder-item'))

    expect(clicked).toHaveBeenCalled()
  })

  it('does not offer a folder to a finger, because iOS Safari cannot pick one', async () => {
    const user = userEvent.setup()
    const real = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      render(<ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders />)
      await user.click(screen.getByTestId('project-upload-trigger'))
      expect(await screen.findByTestId('project-upload-files-item')).toBeInTheDocument()
      expect(screen.queryByTestId('project-upload-folder-item')).toBeNull()
    } finally {
      window.matchMedia = real
    }
  })

  it('does not offer a choice while an upload is running', async () => {
    render(<ProjectUppyUpload onUpload={vi.fn()} isUploading allowFolders />)

    expect(screen.getByRole('button')).toBeDisabled()
  })
})
