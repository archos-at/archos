import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { FileItem, OfficeShelfWorkspaceProps } from '@/features/documents'
import type { NormRecognition } from '@/lib/base-knowledge/wire'
import { toast } from 'sonner'
import { capturePosthog } from '@/lib/analytics/posthog'
import { OfficeShelfWithNorms } from './office-shelf-with-norms'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

const shelf = vi.hoisted(() => ({ props: null as OfficeShelfWorkspaceProps | null }))
vi.mock('@/features/documents', () => ({
  OfficeShelfWorkspace: (props: OfficeShelfWorkspaceProps) => {
    shelf.props = props
    return <div data-testid="office-shelf" />
  },
}))

const NONE: NormRecognition = { proposals: [], plain: [], topics: { rootId: null, folders: [], nextCursor: null } }
const ONE: NormRecognition = {
  ...NONE,
  proposals: [
    {
      entryId: 'edition_norm',
      documentId: 'doc-norm',
      fileName: 'OENORM_B_5371_2021-01-15_de.pdf',
      kind: 'technical_standard',
      designation: 'ÖNORM B 5371',
      editionLabel: '2021-01-15',
      topicId: null,
      editionOf: null,
      duplicate: false,
    },
  ],
}

function stubRecognition(answer: NormRecognition) {
  const fetchMock = vi.fn(async () => Response.json(answer))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const bodyOf = (fetchMock: ReturnType<typeof stubRecognition>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
  return [url, JSON.parse(String(init.body))]
}

const renderShelf = (canManage = true) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <OfficeShelfWithNorms canManage={canManage} />
    </I18nProvider>,
  )

const file = (id: string) => ({ id, filename: `${id}.pdf` }) as FileItem

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(capturePosthog).mockClear()
  shelf.props = null
})

describe('the Büroablage with its norms', () => {
  it('recognises the norms of an upload and opens the norm dialog for them', async () => {
    const fetchMock = stubRecognition(ONE)
    renderShelf()
    await act(async () => shelf.props?.onUploadsStored?.([{ documentId: 'doc-norm', fileName: 'a.pdf' }, { documentId: 'doc-plan', fileName: 'b.pdf' }]))
    expect(await screen.findByTestId('norm-dialog')).toBeTruthy()
    expect(screen.getByText('1 Norm erkannt')).toBeTruthy()
    expect(bodyOf(fetchMock)).toEqual(['/api/base-knowledge/recognize', { documentIds: ['doc-norm', 'doc-plan'] }])
  })

  it('opens no dialog when nothing uploaded is a norm', async () => {
    const fetchMock = stubRecognition(NONE)
    renderShelf()
    await act(async () => shelf.props?.onUploadsStored?.([{ documentId: 'doc-plan', fileName: 'b.pdf' }]))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('norm-dialog')).toBeNull()
  })

  it('opens the dialog for an ordinary file kept as a norm', async () => {
    const fetchMock = stubRecognition(ONE)
    renderShelf()
    const [action] = shelf.props?.fileActions?.(file('doc-plan')) ?? []
    expect(action).toMatchObject({ type: 'item', label: 'Als Norm führen' })
    await act(async () => (action?.type === 'item' ? action.onSelect?.() : undefined))
    expect(await screen.findByTestId('norm-dialog')).toBeTruthy()
    expect(bodyOf(fetchMock)).toEqual(['/api/base-knowledge/recognize', { documentIds: ['doc-plan'], asNorm: true }])
  })

  it('opens the norm dialog for the norms a folder moved under Normen & Richtlinien', async () => {
    const fetchMock = stubRecognition(ONE)
    renderShelf()
    await act(async () => shelf.props?.onNormsRecorded?.(['doc-norm']))
    expect(await screen.findByTestId('norm-dialog')).toBeTruthy()
    expect(bodyOf(fetchMock)).toEqual(['/api/base-knowledge/recognize', { documentIds: ['doc-norm'] }])
  })

  it('tells about a guideline the platform already knows, the only feedback an Ordner upload of one gets', async () => {
    stubRecognition({
      ...NONE,
      plain: [{ documentId: 'doc-oib', fileName: 'OIB-Richtlinie_2_2023.pdf', folderId: null, folderPath: null, platformHeld: true }],
    })
    renderShelf()
    await act(async () => shelf.props?.onUploadsStored?.([{ documentId: 'doc-oib', fileName: 'OIB-Richtlinie_2_2023.pdf' }]))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Diese Richtlinie kennt')))
    expect(screen.queryByTestId('norm-dialog')).toBeNull()
  })

  it('offers a reader no way to keep a file as a norm', () => {
    renderShelf(false)
    expect(shelf.props?.fileActions?.(file('doc-plan'))).toEqual([])
  })

  it('counts the dialog an upload opened, and a „Später“ for all its rows', async () => {
    stubRecognition(ONE)
    renderShelf()
    await act(async () => shelf.props?.onUploadsStored?.([{ documentId: 'doc-norm', fileName: 'a.pdf' }]))
    await userEvent.click(await screen.findByTestId('norm-dialog-later'))
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_shown', { rows: 1, source: 'office_shelf_upload' })
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_settled', {
      confirmed: 0,
      not_norm: 0,
      later: 1,
      edition_added: 0,
      duplicate_removed: 0,
      source: 'office_shelf_upload',
    })
  })

  it('counts what the settle of a folder’s norms did, by the server’s outcome', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      Response.json(url.endsWith('/settle') ? { results: [{ entryId: 'edition_norm', outcome: 'confirmed', error: null }] } : ONE),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderShelf()
    await act(async () => shelf.props?.onNormsRecorded?.(['doc-norm']))
    await userEvent.click(await screen.findByTestId('norm-dialog-confirm'))
    await waitFor(() =>
      expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_settled', {
        confirmed: 1,
        not_norm: 0,
        later: 0,
        edition_added: 0,
        duplicate_removed: 0,
        source: 'folder_migration',
      }),
    )
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_shown', { rows: 1, source: 'folder_migration' })
  })
})
