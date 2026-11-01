/**
 * A stage in the review (a Skizze's canvas where a PDF's pages would be,
 * ADR-0148): the review keeps its header, list and keys, and yields what the
 * stage owns. Its page tools, own cursor and page menu step aside; its letters
 * and its Escape do nothing while the focus is in the stage's canvas; closing
 * asks the stage first.
 *
 * The stage is a stand-in: a canvas that takes the keyboard, and a line that
 * says which mark the review has in hand.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, render, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import type { RoomFrame } from '@/lib/annotations/room-types'
import type { AnnotationView } from '@/lib/annotations/types'
import { useChatStore } from '@/features/chat/store'
import { useDocumentReview, type DocumentReview } from '../../hooks/use-document-review'
import type { RoomTransport } from '../../hooks/use-document-room'
import type { ReviewStageSlots } from '../../preview-actions'
import { DocumentReviewMode } from './document-review'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))

vi.mock('@/features/knowledge/components/pdf-document-view', () => ({
  PdfDocumentView: () => <div data-testid="pdf-view" />,
}))

const mark = (overrides: Partial<AnnotationView>): AnnotationView => ({
  id: 'ann_1',
  documentId: 'doc_1',
  number: 1,
  page: 1,
  shape: 'region',
  x: 0.25,
  y: 0.5,
  w: 0.1,
  h: 0.1,
  elementIds: ['stair'],
  kind: 'hint',
  body: 'Breite prüfen',
  basis: null,
  authorKind: 'person',
  status: 'open',
  assigneeUserId: null,
  assigneeName: null,
  dueOn: null,
  revisionNumber: 1,
  onCurrentRevision: true,
  createdBy: 'user_me',
  createdByName: 'Miriam Hofer',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  delegatedBy: null,
  delegatedByName: null,
  delegatedAt: null,
  replies: [],
  canEdit: true,
  canDelete: true,
  ...overrides,
})

const room = (): RoomTransport => ({
  connect({ onFrame, onOpen }) {
    onOpen()
    onFrame({ kind: 'welcome', self: { userId: 'user_me', name: 'Miriam Hofer', kind: 'person' } } as RoomFrame)
    return () => {}
  },
  post: () => {},
})

/** The canvas: it takes the keyboard (`data-stage-keys`), and its strokes may be unsaved. */
function FakeStage({ review, headerSlot, setCloseGuard, close, dirty }: ReviewStageSlots & { review: DocumentReview; dirty: boolean }) {
  setCloseGuard(() => !dirty)
  return (
    <div data-testid="fake-stage" data-selected={review.selectedId ?? ''}>
      <div data-stage-keys tabIndex={0} data-testid="fake-canvas" />
      {headerSlot ? createPortal(<button type="button">Save</button>, headerSlot) : null}
      <button type="button" onClick={close}>
        discard
      </button>
    </div>
  )
}

function Host({ dirty = false, onOpenChange = () => {} }: { dirty?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [transport] = useState(room)
  const review = useDocumentReview('doc_1', { enabled: true, transport })
  return (
    <DocumentReviewMode
      open
      onOpenChange={onOpenChange}
      review={review}
      documentName="Stiege.svg"
      revisionLabel="Version 2"
      canPickAssignee={false}
      initialTool="point"
      stage={(slots) => <FakeStage {...slots} review={review} dirty={dirty} />}
    />
  )
}

beforeEach(() => {
  window.localStorage.clear()
  server.use(
    http.get('/api/documents/:id/annotations', () =>
      HttpResponse.json({ annotations: [mark({ id: 'ann_1' }), mark({ id: 'ann_2', number: 2 })], canAnnotate: true, pilotiWakes: false })
    )
  )
})

describe('a stage in the review', () => {
  it('keeps the header and the list, takes the place of the pages, and puts no page tools beside it', async () => {
    render(<Host />)
    const review = await screen.findByTestId('document-review')
    expect(within(review).getByRole('heading', { name: 'Stiege.svg' })).toBeInTheDocument()
    expect(within(review).getByTestId('fake-stage')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-view')).toBeNull()
    await screen.findAllByTestId('review-row')
    // The stage's own control is in the review's header.
    expect(within(screen.getByTestId('review-stage-actions')).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    // No point, box or Piloti tool, no own cursor, no page menu: the canvas has its own.
    expect(screen.queryByTestId('review-tools')).toBeNull()
    expect(screen.queryByTestId('review-tool-hint')).toBeNull()
    expect(screen.queryByTestId('own-cursor')).toBeNull()
    expect(screen.queryByTestId('review-page-menu')).toBeNull()
  })

  it('says how a mark is set on a canvas when there is none: on its elements, not with C or R', async () => {
    server.use(http.get('/api/documents/:id/annotations', () => HttpResponse.json({ annotations: [], canAnnotate: true, pilotiWakes: false })))
    render(<Host />)
    expect(await screen.findByTestId('review-empty')).toHaveTextContent('Select elements on the canvas')
  })

  it('does not take the canvas’s keys: J and E while drawing are Excalidraw’s', async () => {
    render(<Host />)
    await screen.findAllByTestId('review-row')
    const canvas = screen.getByTestId('fake-canvas')
    fireEvent.keyDown(canvas, { key: 'j' })
    expect(screen.getByTestId('fake-stage').dataset.selected).toBe('')
    // Outside the canvas the review's walk is there as on any document.
    fireEvent.keyDown(window, { key: 'j' })
    await waitFor(() => expect(screen.getByTestId('fake-stage').dataset.selected).toBe('ann_1'))
    fireEvent.keyDown(canvas, { key: 'j' })
    expect(screen.getByTestId('fake-stage').dataset.selected).toBe('ann_1')
  })

  it('leaves Escape in the canvas to the canvas: the review stays open', async () => {
    const onOpenChange = vi.fn()
    render(<Host onOpenChange={onOpenChange} />)
    const canvas = await screen.findByTestId('fake-canvas')
    act(() => canvas.focus())
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('asks the stage before it closes, and closes when the stage lets it go', async () => {
    const onOpenChange = vi.fn()
    render(<Host dirty onOpenChange={onOpenChange} />)
    await screen.findByTestId('fake-stage')
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'discard' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
