import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('@/lib/office-shelf/folder-norms-client', () => ({ fetchFolderNorms: vi.fn(), decideFolderNorms: vi.fn() }))

import { decideFolderNorms, fetchFolderNorms } from '@/lib/office-shelf/folder-norms-client'
import { OfficeShelfFolderNorms } from './office-shelf-folder-norms'

const NORM = { documentId: 'doc-1', fileName: 'OENORM_B_1600.pdf', designation: 'ÖNORM B 1600' }
const found = (total: number) => ({ folderId: 'folder-1', total, norms: total ? [NORM] : [], nextCursor: null })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficeShelfFolderNorms', () => {
  it('says how many files in the folder are norms and offers both ways', async () => {
    vi.mocked(fetchFolderNorms).mockResolvedValue(found(2))
    render(<OfficeShelfFolderNorms folderId="folder-1" onChanged={vi.fn()} />)
    expect(await screen.findByText('2 files here are standards.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move to Standards & guidelines' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep in folder' })).toBeInTheDocument()
    expect(fetchFolderNorms).toHaveBeenCalledWith('folder-1')
  })

  it('shows nothing in a folder without norms, or when the folder cannot be read', async () => {
    vi.mocked(fetchFolderNorms).mockResolvedValueOnce(found(0))
    const { container, rerender } = render(<OfficeShelfFolderNorms folderId="folder-1" onChanged={vi.fn()} />)
    await waitFor(() => expect(fetchFolderNorms).toHaveBeenCalledTimes(1))
    expect(container).toBeEmptyDOMElement()
    vi.mocked(fetchFolderNorms).mockRejectedValueOnce(new Error('Request failed with 403'))
    rerender(<OfficeShelfFolderNorms folderId="folder-2" onChanged={vi.fn()} />)
    await waitFor(() => expect(fetchFolderNorms).toHaveBeenCalledTimes(2))
    expect(container).toBeEmptyDOMElement()
  })

  it('moves the norms, says where they wait, reloads the folder and reads it again', async () => {
    vi.mocked(fetchFolderNorms).mockResolvedValueOnce(found(1)).mockResolvedValueOnce(found(0))
    vi.mocked(decideFolderNorms).mockResolvedValue({ action: 'record', done: [NORM], failed: [], remaining: 0 })
    const onChanged = vi.fn()
    const { container } = render(<OfficeShelfFolderNorms folderId="folder-1" onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Move to Standards & guidelines' }))
    expect(decideFolderNorms).toHaveBeenCalledWith('folder-1', { action: 'record' })
    expect(toast.success).toHaveBeenCalledWith('1 moved to Standards & guidelines. They wait there under “To confirm”.')
    expect(onChanged).toHaveBeenCalled()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hands the moved norms to the norm dialog instead of only saying where they wait', async () => {
    vi.mocked(fetchFolderNorms).mockResolvedValueOnce(found(1)).mockResolvedValueOnce(found(0))
    vi.mocked(decideFolderNorms).mockResolvedValue({ action: 'record', done: [NORM], failed: [], remaining: 0 })
    const onRecorded = vi.fn()
    render(<OfficeShelfFolderNorms folderId="folder-1" onChanged={vi.fn()} onRecorded={onRecorded} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Move to Standards & guidelines' }))
    expect(onRecorded).toHaveBeenCalledWith(['doc-1'])
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the norms in the folder and says it will not ask again', async () => {
    vi.mocked(fetchFolderNorms).mockResolvedValueOnce(found(1)).mockResolvedValueOnce(found(0))
    vi.mocked(decideFolderNorms).mockResolvedValue({ action: 'keep', done: [NORM], failed: [], remaining: 0 })
    render(<OfficeShelfFolderNorms folderId="folder-1" onChanged={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Keep in folder' }))
    expect(decideFolderNorms).toHaveBeenCalledWith('folder-1', { action: 'keep' })
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/stay in the folder as ordinary files/)
  })

  it('says so when the decision fails', async () => {
    vi.mocked(fetchFolderNorms).mockResolvedValue(found(1))
    vi.mocked(decideFolderNorms).mockRejectedValue(new Error('Request failed with 500'))
    const onChanged = vi.fn()
    render(<OfficeShelfFolderNorms folderId="folder-1" onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Keep in folder' }))
    expect(toast.error).toHaveBeenCalledWith('That did not work. Please try again.')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
