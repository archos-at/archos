import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderItem } from '../file-types'
import type { UploadFilesOptions } from './use-file-upload'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))

const decision = vi.hoisted(() => ({
  open: false,
  pending: false,
  propose: vi.fn(),
}))
const sealed = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../lib/upload-batch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/upload-batch')>()),
  sealHeldUploadBatch: sealed,
}))

vi.mock('./use-upload-decision', () => ({
  useUploadDecision: () => ({
    ...decision,
    plan: null,
    kind: 'files',
    setReleased: vi.fn(),
    settle: vi.fn(),
    changeRevision: vi.fn(),
    changeConflict: vi.fn(),
    setOpen: vi.fn(),
    setPending: vi.fn(),
  }),
}))

import { toast } from 'sonner'
import { useShelfUpload, type ShelfUploadOptions } from './use-shelf-upload'

const FOLDERS: FolderItem[] = [
  { id: 'f1', name: 'Planung', parentId: null, path: 'Planung' },
  { id: 'f2', name: 'Statik', parentId: 'f1', path: 'Planung/Statik' },
]

const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' })

function setup(overrides: Partial<ShelfUploadOptions> = {}) {
  const uploadFiles = vi.fn<(files: File[], options?: UploadFilesOptions) => Promise<number>>(
    async (files) => files.length
  )
  const initial: ShelfUploadOptions = {
    shelf: {
      probeNames: vi.fn(),
      probeRevisions: vi.fn(),
      handoverKey: null,
      endpoints: { folders: '/api/projects/p1/folders' },
    } as unknown as ShelfUploadOptions['shelf'],
    upload: { uploadFiles },
    folders: FOLDERS,
    foldersReady: true,
    selectedFolderId: 'f2',
    loadFolders: vi.fn(async () => undefined),
    loadFiles: vi.fn(async () => undefined),
    uploading: false,
    ...overrides,
  }
  const hook = renderHook((props: ShelfUploadOptions) => useShelfUpload(props), { initialProps: initial })
  const rerender = (next: Partial<ShelfUploadOptions>) => hook.rerender({ ...initial, ...next })
  return { ...hook, uploadFiles, rerender }
}

const filed = (uploadFiles: ReturnType<typeof setup>['uploadFiles']) =>
  uploadFiles.mock.calls.flatMap(([files, options]) =>
    files.map((file) => ({ name: file.name, folderId: options?.folderIdFor?.(file), path: options?.folderPathFor?.(file) }))
  )

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.clearAllMocks()
  decision.open = false
  decision.pending = false
  decision.propose.mockImplementation(async (input: { files: File[] }, direct: (files: File[]) => void) => {
    direct(input.files)
  })
})

describe('useShelfUpload — where a drop lands', () => {
  it('files a drop on the workspace in the folder on screen', async () => {
    const { result, uploadFiles } = setup()
    act(() => result.current.handleUpload([pdf('a.pdf')]))
    await flush()
    expect(filed(uploadFiles)).toEqual([{ name: 'a.pdf', folderId: 'f2', path: 'Planung/Statik' }])
  })

  it('files a drop on a folder tile in THAT folder, and plans it there', async () => {
    const { result, uploadFiles } = setup()
    act(() => result.current.handleUpload([pdf('a.pdf')], { folderId: 'f1' }))
    await flush()
    expect(filed(uploadFiles)).toEqual([{ name: 'a.pdf', folderId: 'f1', path: 'Planung' }])
    expect(decision.propose.mock.calls[0][0]).toMatchObject({ currentFolderId: 'f1', screeningBasePath: 'Planung' })
  })

  it('files a drop on „Alle Dateien" at the top level', async () => {
    const { result, uploadFiles } = setup()
    act(() => result.current.handleUpload([pdf('a.pdf')], { folderId: null }))
    await flush()
    expect(filed(uploadFiles)).toEqual([{ name: 'a.pdf', folderId: null, path: null }])
  })
})

describe('useShelfUpload — no drop lost', () => {
  it('sends both of two quick drops, each where it was aimed', async () => {
    const { result, uploadFiles } = setup()
    act(() => {
      result.current.handleUpload([pdf('a.pdf')], { folderId: 'f1' })
      result.current.handleUpload([pdf('b.pdf')])
    })
    await flush()
    await flush()
    expect(filed(uploadFiles)).toEqual([
      { name: 'a.pdf', folderId: 'f1', path: 'Planung' },
      { name: 'b.pdf', folderId: 'f2', path: 'Planung/Statik' },
    ])
  })

  it('holds a drop made while an upload runs, says so, and sends it when the upload is done', async () => {
    const { result, uploadFiles, rerender } = setup({ uploading: true })
    act(() => result.current.handleUpload([pdf('a.pdf')]))
    await flush()
    expect(uploadFiles).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledTimes(1)

    rerender({ uploading: false })
    await flush()
    expect(filed(uploadFiles)).toEqual([{ name: 'a.pdf', folderId: 'f2', path: 'Planung/Statik' }])
  })

  it('holds a drop while the plan dialog is open, rather than replacing the plan', async () => {
    decision.open = true
    const { result, uploadFiles, rerender } = setup()
    act(() => result.current.handleUpload([pdf('a.pdf')]))
    await flush()
    expect(decision.propose).not.toHaveBeenCalled()

    decision.open = false
    rerender({})
    await flush()
    expect(filed(uploadFiles).map((each) => each.name)).toEqual(['a.pdf'])
  })

  it('waits quietly for the folders, so a dropped tree is planned against them', async () => {
    const { result, uploadFiles, rerender } = setup({ foldersReady: false })
    act(() => result.current.handleUpload([pdf('a.pdf')]))
    await flush()
    expect(uploadFiles).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()

    rerender({ foldersReady: true })
    await flush()
    expect(uploadFiles).toHaveBeenCalledTimes(1)
  })
})

describe('useShelfUpload — a tree that did not load', () => {
  it('sends a drop made after the folders failed to load, rather than holding it for a tree that may never come', async () => {
    const { result, uploadFiles } = setup({ foldersReady: false, foldersSettled: true })
    act(() => result.current.handleUpload([pdf('a.pdf')]))
    await flush()
    expect(uploadFiles).toHaveBeenCalledTimes(1)
  })
})

describe('useShelfUpload — what a drop could not hand over', () => {
  it('warns when the drop held more than was taken, and when files could not be read', async () => {
    const { result, uploadFiles } = setup()
    act(() => result.current.handleUpload([pdf('a.pdf')], { info: { truncated: true, unreadable: 2 } }))
    await flush()
    expect(toast.warning).toHaveBeenCalledTimes(2)
    expect(uploadFiles).toHaveBeenCalledTimes(1)
  })

  it('still says so when nothing at all could be read', async () => {
    const { result, uploadFiles } = setup()
    act(() => result.current.handleUpload([], { info: { truncated: false, unreadable: 3 } }))
    await flush()
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(uploadFiles).not.toHaveBeenCalled()
  })
})

describe('useShelfUpload — a name the server says the folder already holds', () => {
  const conflict = (name: string) => ({
    reason: 'name_conflict' as const,
    name,
    folderId: 'f2',
    existingDocumentId: 'held',
    existingName: name,
    suggestedName: name.replace('.pdf', ' 2.pdf'),
  })
  const held = { id: 'batch-1', unchanged: 0, failed: 0, excluded: [] }

  function clashing() {
    const view = setup()
    view.uploadFiles.mockImplementationOnce(async (files, options) => {
      options?.onNameConflicts?.(
        files.map((file) => ({ file, conflict: conflict(file.name) })),
        held,
        options
      )
      return 0
    })
    return view
  }

  it('asks once for every clash of the batch, keeping both by default, and re-sends the answers into the same batch', async () => {
    const { result, uploadFiles } = clashing()
    act(() => result.current.handleUpload([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]))
    await flush()

    const question = result.current.conflictPrompt.question
    expect(question?.rows.map((row) => [row.path, row.choice, row.keepBothAs])).toEqual([
      ['a.pdf', 'keep_both', 'a 2.pdf'],
      ['b.pdf', 'keep_both', 'b 2.pdf'],
      ['c.pdf', 'keep_both', 'c 2.pdf'],
    ])
    act(() =>
      result.current.conflictPrompt.resolve(
        new Map([
          ['0', 'replace'],
          ['1', 'keep_both'],
          ['2', 'skip'],
        ])
      )
    )
    await flush()

    expect(uploadFiles).toHaveBeenCalledTimes(2)
    const [resent, options] = uploadFiles.mock.calls[1]!
    expect(resent.map((file) => [file.name, options?.onConflict?.(file), options?.folderIdFor?.(file)])).toEqual([
      ['a.pdf', 'replace', 'f2'],
      ['b.pdf', 'keep_both', 'f2'],
    ])
    expect(options?.continueBatch).toEqual({ ...held, unchanged: 1 })
    expect(options?.excludedByScreening).toEqual([])
    expect(sealed).not.toHaveBeenCalled()
  })

  it('sends nothing more, and closes the batch, when the reader cancels the question', async () => {
    const { result, uploadFiles } = clashing()
    act(() => result.current.handleUpload([pdf('a.pdf')]))
    await flush()

    act(() => result.current.conflictPrompt.resolve(null))
    await flush()

    expect(uploadFiles).toHaveBeenCalledTimes(1)
    expect(sealed).toHaveBeenCalledWith(held, 1)
  })
})
