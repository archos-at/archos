import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { FileItem, OfficeShelfWorkspaceProps } from '@/features/documents'
import type { NormRecognition } from '@/lib/base-knowledge/wire'
import { OfficeShelfWithNorms } from './office-shelf-with-norms'

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

  it('offers a reader no way to keep a file as a norm', () => {
    renderShelf(false)
    expect(shelf.props?.fileActions?.(file('doc-plan'))).toEqual([])
  })
})
