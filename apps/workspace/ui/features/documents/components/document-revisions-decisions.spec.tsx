import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@/test-utils'
import { toast } from 'sonner'
import { PRODUCT_NAME } from '@/lib/brand'
import { DocumentLifecycleError } from '@/lib/documents/lifecycle-client'
import {
  clientOf,
  copy,
  facts,
  fakeClient,
  fileFixture,
  listing,
  makeVersion,
  ref,
  renderSection,
  reviewed,
  reviewer,
  toggle,
} from './document-revisions.fixtures'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
})

describe('DocumentRevisions — the decisions on the newest Fassung', () => {
  it('shows Freigeben and Änderungen anfordern, and keeps the delegate-revision action and Ablehnen behind ⋯', async () => {
    renderSection({ viewer: reviewer, client: clientOf([makeVersion(1, 'published'), reviewed(2, 'in_review')]) })

    expect(await screen.findByRole('button', { name: 'Freigeben' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Änderungen anfordern' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).toBeNull()
    expect(screen.queryByRole('button', { name: `${PRODUCT_NAME} überarbeiten lassen` })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Veröffentlichen' })).toBeNull()

    await userEvent.click(screen.getByTestId('document-review-more'))
    expect(await screen.findByRole('menuitem', { name: `${PRODUCT_NAME} überarbeiten lassen` })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Ablehnen' })).toHaveAttribute('data-variant', 'destructive')
  })

  it('says what approving means, where approving is offered', async () => {
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')]) })

    expect(await screen.findByTestId('revision-approve-explain')).toHaveTextContent('Freigeben heißt: Das Büro steht für den Inhalt ein.')
  })

  it('will not send Änderungen anfordern until something is typed', async () => {
    const requestChanges = vi.fn().mockResolvedValue(makeVersion(1, 'changes_requested'))
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')], { requestChanges }) })

    await userEvent.click(await screen.findByRole('button', { name: 'Änderungen anfordern' }))
    const send = screen.getByTestId('document-review-comment-send')
    expect(send).toBeDisabled()
    expect(requestChanges).not.toHaveBeenCalled()

    await userEvent.type(screen.getByRole('textbox'), 'Die Fluchtweglänge fehlt.')
    await userEvent.click(send)

    await waitFor(() =>
      expect(requestChanges).toHaveBeenCalledWith('doc_1', 'ver_1', 'Die Fluchtweglänge fehlt.', undefined, 'sha256:abc'),
    )
  })

  it('delegates the revision to the agent from the ⋯, on the same route, with the one extra field', async () => {
    const requestChanges = vi.fn().mockResolvedValue(makeVersion(1, 'changes_requested'))
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')], { requestChanges }) })

    await userEvent.click(await screen.findByTestId('document-review-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: `${PRODUCT_NAME} überarbeiten lassen` }))
    expect(await screen.findByTestId('document-review-delegate-note')).toBeInTheDocument()
    expect(screen.getByTestId('document-review-comment-send')).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'Bitte Tabelle 3 neu rechnen.')
    await userEvent.click(screen.getByTestId('document-review-comment-send'))

    await waitFor(() =>
      expect(requestChanges).toHaveBeenCalledWith('doc_1', 'ver_1', 'Bitte Tabelle 3 neu rechnen.', true, 'sha256:abc'),
    )
  })

  it('releases Freigeben only once the Fassung is signed, named by its number in the timeline', async () => {
    const approve = vi.fn().mockResolvedValue(makeVersion(1, 'approved'))
    renderSection({
      file: fileFixture({
        revision: facts({ history: [{ id: 'doc_a', filename: 'EG_Index_A.pdf', createdAt: '2026-06-01T09:00:00Z', changeSummary: null }] }),
      }),
      viewer: reviewer,
      names: { user_reviewer: 'DI Huber' },
      client: clientOf([reviewed(1, 'in_review')], { approve }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }))
    expect(approve).not.toHaveBeenCalled()
    expect(screen.getByTestId('document-review-approve-as-of')).toHaveTextContent('Fassung 2')
    expect(screen.getByTestId('document-review-approve-acting')).toHaveTextContent('DI Huber')
    const send = screen.getByTestId('document-review-approve-send')
    expect(send).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: copy.lifecycle.approveConfirm.checkbox }))
    await userEvent.click(send)

    await waitFor(() => expect(approve).toHaveBeenCalledWith('doc_1', 'ver_1', undefined, 'sha256:abc'))
  })

  it('keeps Einreichen shut until the order is stated, and sends the order with the call', async () => {
    const submit = vi.fn().mockResolvedValue(makeVersion(1, 'in_review'))
    renderSection({ viewer: reviewer, client: clientOf([makeVersion(1, 'draft')], { submit }) })

    const send = await screen.findByTestId('document-lifecycle-submit')
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByTestId('document-review-order'), 'Bitte prüfen.')
    expect(send).toBeEnabled()
    await userEvent.click(send)

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('doc_1', 'ver_1', undefined, { orderMessage: 'Bitte prüfen.', dueAt: undefined }),
    )
  })

  it('publishes from its own control, with the next step in the header rather than a second blurb', async () => {
    const publish = vi.fn().mockResolvedValue(makeVersion(1, 'published'))
    renderSection({
      viewer: { permissions: ['project:view', 'project:documents:write'], userId: 'user_x' },
      client: clientOf([reviewed(1, 'approved')], { publish }),
    })

    expect(await screen.findByTestId('revision-next-step')).toHaveTextContent('Nächster Schritt: Ihre Veröffentlichung')
    expect(screen.getByTestId('document-review-publish')).not.toHaveTextContent(copy.lifecycle.publishSection.heading)
    await userEvent.click(screen.getByTestId('document-lifecycle-publish'))
    await waitFor(() => expect(publish).toHaveBeenCalledWith('doc_1', 'ver_1'))
  })

  it('moves the row at once, tells the listing, and re-reads rather than patching', async () => {
    const approve = vi.fn().mockResolvedValue(makeVersion(1, 'approved'))
    const listVersions = vi
      .fn()
      .mockResolvedValueOnce(listing([reviewed(1, 'in_review')]))
      .mockResolvedValue(listing([reviewed(1, 'approved', { approvedBy: 'user_reviewer' })]))
    const onLifecycleChanged = vi.fn()
    renderSection({ viewer: reviewer, client: fakeClient({ listVersions, approve }), onLifecycleChanged })

    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }))
    await userEvent.click(screen.getByRole('checkbox', { name: copy.lifecycle.approveConfirm.checkbox }))
    await userEvent.click(screen.getByTestId('document-review-approve-send'))

    await waitFor(() => expect(listVersions).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(onLifecycleChanged).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc_1', state: 'approved', versionCount: 1 }),
      ),
    )
    expect(screen.getByTestId('document-lifecycle-state')).toHaveTextContent('Freigegeben')
  })

  it('says the decision has moved when the compare-and-swap is lost, and re-reads it', async () => {
    const approve = vi.fn().mockRejectedValue(new DocumentLifecycleError(409, 'CONFLICT', 'state changed'))
    const listVersions = vi
      .fn()
      .mockResolvedValueOnce(listing([reviewed(1, 'in_review')]))
      .mockResolvedValue(listing([reviewed(1, 'approved', { approvedBy: 'user_other' })]))
    renderSection({ viewer: reviewer, client: fakeClient({ listVersions, approve }) })

    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }))
    await userEvent.click(screen.getByRole('checkbox', { name: copy.lifecycle.approveConfirm.checkbox }))
    await userEvent.click(screen.getByTestId('document-review-approve-send'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy.lifecycle.errors.conflict))
    await waitFor(() => expect(listVersions).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('Freigegeben')
  })

  it('says why the agent may not revise a draft in a restricted folder', async () => {
    const reason = 'Dieses Dokument liegt in einem Ordner mit eingeschränktem Zugriff.'
    const requestChanges = vi
      .fn()
      .mockRejectedValue(new DocumentLifecycleError(403, 'CONVERSATION_CONFINED', reason, { action: 'revision' }))
    renderSection({ viewer: reviewer, client: clientOf([reviewed(1, 'in_review')], { requestChanges }) })

    await userEvent.click(await screen.findByTestId('document-review-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: `${PRODUCT_NAME} überarbeiten lassen` }))
    await userEvent.type(await screen.findByRole('textbox'), 'Bitte Tabelle 3 neu rechnen.')
    await userEvent.click(screen.getByTestId('document-review-comment-send'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason))
    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('In Prüfung')
  })

  it('puts the row back when the request fails for any other reason', async () => {
    renderSection({
      viewer: reviewer,
      client: clientOf([reviewed(1, 'in_review')], {
        approve: () => Promise.reject(new DocumentLifecycleError(500, 'INTERNAL', 'boom')),
      }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }))
    await userEvent.click(screen.getByRole('checkbox', { name: copy.lifecycle.approveConfirm.checkbox }))
    await userEvent.click(screen.getByTestId('document-review-approve-send'))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('In Prüfung')
  })

  it('says a held file is still being checked, rather than that the decision moved', async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(new DocumentLifecycleError(409, 'CONFLICT', 'held', { op: 'submit', reason: 'held' }))
    renderSection({ viewer: reviewer, client: clientOf([makeVersion(1, 'draft')], { submit }) })

    await userEvent.type(await screen.findByTestId('document-review-order'), 'Bitte prüfen.')
    await userEvent.click(screen.getByTestId('document-lifecycle-submit'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy.lifecycle.errors.held))
    expect(await screen.findByTestId('document-lifecycle-state')).toHaveTextContent('Entwurf')
  })

  it('retires the item from one quiet line, through its own confirm, and tells the listing', async () => {
    const archive = vi.fn().mockResolvedValue({ documentId: 'doc_1', lifecycle: 'archived' })
    const listVersions = vi
      .fn()
      .mockResolvedValueOnce(listing([makeVersion(1, 'published')]))
      .mockResolvedValue(listing([makeVersion(1, 'published')], { lifecycle: 'archived' }))
    const onLifecycleChanged = vi.fn()
    renderSection({
      viewer: { permissions: ['project:view', 'project:documents:write'], userId: 'user_x' },
      client: fakeClient({ listVersions, archive }),
      onLifecycleChanged,
    })

    await userEvent.click(await toggle())
    const line = await screen.findByTestId('document-lifecycle-archive')
    expect(line).toHaveTextContent('Datei stilllegen')
    expect(screen.getByTestId('document-archive-action')).not.toHaveTextContent(copy.lifecycle.archiveSection.blurb)
    await userEvent.click(line)
    await userEvent.click(await screen.findByTestId('document-archive-confirm'))

    await waitFor(() => expect(archive).toHaveBeenCalledWith('doc_1'))
    await waitFor(() =>
      expect(onLifecycleChanged).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc_1', lifecycle: 'archived' })),
    )
  })

  it('degrades to the linked history with one quiet line when the versions cannot be read', async () => {
    renderSection({
      viewer: reviewer,
      client: fakeClient({ listVersions: () => Promise.reject(new Error('down')) }),
      file: fileFixture({ revision: facts({ supersededBy: ref('doc_2', 'Grundriss_D.pdf') }) }),
    })

    expect(await screen.findByTestId('document-lifecycle-failed')).toHaveTextContent(copy.lifecycle.errors.loadFailed)
    expect(screen.getAllByTestId('revision-timeline-row')[0]).toHaveTextContent('Grundriss_D.pdf')
  })
})
