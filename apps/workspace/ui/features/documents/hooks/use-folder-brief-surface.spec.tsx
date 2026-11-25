import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactElement } from 'react'
import { emptyTally, type FolderBrief } from '../lib/folder-knowledge'
import type { FileShelf } from '../lib/file-shelf'
import { useFolderBriefSurface } from './use-folder-brief-surface'

vi.mock('./use-missing-documents', () => ({ useMissingDocuments: () => null }))
vi.mock('./use-document-findings', () => ({ useDocumentFindings: () => null }))

const brief: FolderBrief = {
  tally: { ...emptyTally(), total: 2, failed: 2 },
  files: [],
  documentTypes: [],
  disciplines: [],
  contents: [],
  attention: { failed: [], held: [], unplaced: [] },
  reading: [],
  hotspots: [],
  topics: [],
  photos: null,
}

function render() {
  return renderHook(() =>
    useFolderBriefSurface({
      shelf: { projectId: null, source: 'personal' } as unknown as FileShelf,
      brief,
      folders: [],
      selectedFolderId: null,
      onOpenFolder: () => {},
      onReingested: () => {},
      onReadAgainDone: () => {},
      onRequestDetails: () => {},
      detailsLoading: false,
      mayReadAgain: false,
    }),
  )
}

describe('useFolderBriefSurface unread hint', () => {
  it('opens the failed documents and steps aside while they are listed', () => {
    const { result } = render()
    const hint = result.current.unreadHint as ReactElement<{ onShow: () => void }>
    expect(hint).not.toBeNull()

    act(() => hint.props.onShow())

    expect(result.current.slice?.label).toMatch(/Fehlgeschlagen|Failed/)
    expect(result.current.unreadHint).toBeNull()
  })

  it('comes back once the slice is cleared', () => {
    const { result } = render()
    act(() => (result.current.unreadHint as ReactElement<{ onShow: () => void }>).props.onShow())
    act(() => result.current.slice?.onClear())
    expect(result.current.unreadHint).not.toBeNull()
  })
})
