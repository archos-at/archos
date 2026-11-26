import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ idToken: 'test-token' }) }))
vi.mock('@/adapters/api', () => ({
  createDocumentsClient: () => ({
    getCollection: vi.fn(async () => ({ name: 'proj-collection' })),
    createCollection: vi.fn(),
    deleteFiles: vi.fn(),
    listFiles: vi.fn(),
  }),
}))
vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf',
      acceptedMimeTypes: ['application/pdf'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))
vi.mock('../orchestrator', () => ({
  UploadOrchestrator: {
    setAuthToken: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    handleSessionChange: vi.fn(),
    loadFilesForSession: vi.fn(),
    enqueueJobs: vi.fn(),
    watchDocuments: vi.fn(),
    pollSessionDocuments: vi.fn(),
    stopPolling: vi.fn(),
  },
}))
vi.mock('./use-upload-orchestrator', () => ({ useUploadOrchestrator: vi.fn() }))
vi.mock('@/adapters/api/upload-screening-policy', async (importOriginal) => {
  const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
  return {
    ...(await importOriginal<typeof import('@/adapters/api/upload-screening-policy')>()),
    loadUploadScreeningPolicy: vi.fn().mockResolvedValue(SUGGESTED_SCREENING_POLICY),
  }
})

const posted = vi.hoisted(() => ({ bodies: [] as FormData[] }))
vi.mock('@/lib/http/xhr-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/http/xhr-upload')>()),
  xhrUpload: vi.fn(async ({ url, body }: { url: string; body: FormData }) => {
    if (url === '/api/documents/upload') posted.bodies.push(body)
    return JSON.stringify({ documentId: `doc-${posted.bodies.length}`, jobId: null, status: 'pending' })
  }),
}))

import { useFileUpload } from './use-file-upload'
import { useShelfUpload } from './use-shelf-upload'
import { useDocumentsStore } from '../store'
import type { FolderItem } from '../file-types'

const pathed = (relativePath: string): File => {
  const file = new File(['%PDF'], relativePath.split('/').pop()!, { type: 'application/pdf' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true })
  return file
}

const sent = () =>
  posted.bodies.map((body) => ({
    name: (body.get('file') as File).name,
    origin: body.get('originPath'),
    folderId: body.get('folderId'),
    onConflict: body.get('onConflict'),
  }))

beforeEach(() => {
  posted.bodies = []
  useDocumentsStore.setState({ trackedFiles: [], isUploading: false, error: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/folders/ensure')) {
        const { paths } = JSON.parse(String(init?.body)) as { paths: string[] }
        return Response.json({ folders: [], folderIdByPath: Object.fromEntries(paths.map((path) => [path, `folder:${path}`])) })
      }
      return Response.json({})
    })
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('useFileUpload — same names in different folders reach the server (feld72)', () => {
  const render = () => renderHook(() => useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1' }))

  it('sends two files of one name, each into its own folder', async () => {
    const { result } = render()
    const files = [pathed('Projekt/A/Plan.pdf'), pathed('Projekt/B/Plan.pdf')]
    const folderOf = new Map([
      [files[0], 'folder-a'],
      [files[1], 'folder-b'],
    ])

    let taken = 0
    await act(async () => {
      taken = await result.current.uploadFiles(files, {
        folderIdFor: (file) => folderOf.get(file),
        folderPathFor: (file) => (file === files[0] ? 'Projekt/A' : 'Projekt/B'),
      })
    })

    expect(taken).toBe(2)
    expect(sent()).toEqual([
      { name: 'Plan.pdf', origin: 'Projekt/A/Plan.pdf', folderId: 'folder-a', onConflict: null },
      { name: 'Plan.pdf', origin: 'Projekt/B/Plan.pdf', folderId: 'folder-b', onConflict: null },
    ])
  })

  it('sends all 500 files of 250 name pairs', async () => {
    const { result } = render()
    const files = Array.from({ length: 250 }, (_, i) => `Plan-${String(i + 1).padStart(3, '0')}.pdf`).flatMap((name) => [
      pathed(`Projekt/A/${name}`),
      pathed(`Projekt/B/${name}`),
    ])

    await act(async () => {
      await result.current.uploadFiles(files, {
        folderIdFor: (file) => (file.webkitRelativePath.startsWith('Projekt/A/') ? 'folder-a' : 'folder-b'),
      })
    })

    expect(posted.bodies).toHaveLength(500)
    expect(sent().filter((each) => each.folderId === 'folder-a')).toHaveLength(250)
    expect(useDocumentsStore.getState().error).toBeNull()
  })
})

describe('a dropped feld72 tree, from the drop to the requests', () => {
  it('plans, creates the folders and posts every one of 1,881 files into its own folder', async () => {
    const repeated = Array.from({ length: 248 }, (_, i) => `Detail_${i + 1}.pdf`).flatMap((name, i) => [
      pathed(`feld72/0${i % 7}_Planung/Bestand/${name}`),
      pathed(`feld72/0${i % 7}_Planung/Entwurf/${name}`),
    ])
    const unique = Array.from({ length: 1_881 - repeated.length }, (_, i) =>
      pathed(`feld72/${String(i % 23).padStart(2, '0')}_Ordner/Unterordner_${i % 5}/Datei_${i + 1}.pdf`)
    )
    const files = [...repeated, ...unique]
    const folders: FolderItem[] = []

    const { result } = renderHook(() => {
      const upload = useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1' })
      return useShelfUpload({
        shelf: { probeNames: async () => [], probeRevisions: async () => [], handoverKey: null, endpoints: { folders: '/api/projects/proj-1/folders' }, projectId: 'proj-1' },
        upload,
        folders,
        foldersReady: true,
        selectedFolderId: null,
        loadFolders: async () => undefined,
        loadFiles: async () => undefined,
      })
    })

    act(() => result.current.handleUpload(files))
    await waitFor(() => expect(result.current.decision.plan?.files).toHaveLength(1_881))
    expect(result.current.decision.plan?.counts).toMatchObject({ new: 1_881, collision: 0, uploading: 1_881 })

    await act(async () => {
      await result.current.applyFolderPlan()
    })

    expect(posted.bodies).toHaveLength(1_881)
    const byOrigin = new Map(sent().map((each) => [each.origin, each]))
    for (const file of files) {
      const folder = file.webkitRelativePath.split('/').slice(0, -1).join('/')
      expect(byOrigin.get(file.webkitRelativePath)?.folderId).toBe(`folder:${folder}`)
    }
  }, 60_000)
})
