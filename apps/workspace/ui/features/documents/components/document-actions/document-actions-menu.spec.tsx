import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { DocumentActionsMenu } from './document-actions-menu'

const DOCUMENT = { id: 'doc-1', filename: 'Einreichplan_EG.pdf', displayName: null }

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByTestId('document-actions-trigger'))
}

describe('DocumentActionsMenu — what it offers', () => {
  it('carries download, rename and delete by default, with delete set apart', async () => {
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" />)
    await openMenu(user)

    expect(await screen.findByRole('menuitem', { name: /download/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    const remove = screen.getByRole('menuitem', { name: /delete/i })
    expect(remove).toHaveAttribute('data-variant', 'destructive')
  })

  it('offers only what the surface asked for', async () => {
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" actions={['rename', 'delete']} />)
    await openMenu(user)

    expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /download/i })).not.toBeInTheDocument()
  })

  it('renders nothing at all when a read-only viewer would see an empty menu', () => {
    render(
      <DocumentActionsMenu
        document={DOCUMENT}
        scope="officeShelf"
        actions={['rename', 'delete']}
        canManage={false}
      />
    )
    expect(screen.queryByTestId('document-actions-trigger')).not.toBeInTheDocument()
  })

  it('keeps download for a read-only viewer and drops the mutations', async () => {
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="officeShelf" canManage={false} />)
    await openMenu(user)

    expect(await screen.findByRole('menuitem', { name: /download/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument()
  })
})

describe('DocumentActionsMenu — a surface’s own actions', () => {
  it('adds them after the document’s own, and runs them', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <DocumentActionsMenu
        document={DOCUMENT}
        scope="officeShelf"
        extraEntries={[{ type: 'item', id: 'as-norm', label: 'Als Norm führen', onSelect, testId: 'document-action-as-norm' }]}
      />
    )
    await openMenu(user)

    const items = await screen.findAllByRole('menuitem')
    expect(items.at(-1)).toHaveTextContent('Als Norm führen')
    await user.click(screen.getByTestId('document-action-as-norm'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('shows the menu for them alone when the viewer may do nothing else', async () => {
    const user = userEvent.setup()
    render(
      <DocumentActionsMenu
        document={DOCUMENT}
        scope="officeShelf"
        actions={['rename']}
        canManage={false}
        extraEntries={[{ type: 'item', id: 'as-norm', label: 'Als Norm führen', onSelect: vi.fn() }]}
      />
    )
    await openMenu(user)
    expect(await screen.findAllByRole('menuitem')).toHaveLength(1)
  })
})

describe('DocumentActionsMenu — deleting', () => {
  it('asks first, names the document, and reports it upward on confirm', async () => {
    server.use(http.delete('/api/documents/:id', () => new HttpResponse(null, { status: 204 })))
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" onDeleted={onDeleted} />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))

    expect(await screen.findByText('Delete “Einreichplan_EG.pdf”?')).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('document-delete-confirm'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('doc-1'))
  })

  it('deletes an Archiv document through the org-scoped route', async () => {
    const hits: string[] = []
    server.use(
      http.delete('/api/documents/:id', ({ params }) => {
        hits.push(String(params.id))
        return new HttpResponse(null, { status: 204 })
      })
    )
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="officeShelf" />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
    await user.click(await screen.findByTestId('document-delete-confirm'))

    await waitFor(() => expect(hits).toEqual(['doc-1']))
  })

  it('leaves the question on screen when the delete fails', async () => {
    server.use(http.delete('/api/documents/:id', () => new HttpResponse(null, { status: 500 })))
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" onDeleted={onDeleted} />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
    await user.click(await screen.findByTestId('document-delete-confirm'))

    await waitFor(() => expect(screen.getByTestId('document-delete-confirm')).toBeInTheDocument())
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('says a legal hold keeps the document, instead of a generic failure', async () => {
    const toastError = vi.spyOn((await import('sonner')).toast, 'error')
    server.use(
      http.delete('/api/documents/:id', () =>
        HttpResponse.json(
          { error: 'held', code: 'CONFLICT', details: { reason: 'legal_hold', entityType: 'document' } },
          { status: 409 }
        )
      )
    )
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" onDeleted={onDeleted} />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))
    await user.click(await screen.findByTestId('document-delete-confirm'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/legal hold|rechtlichen Sperre/i)))
    expect(onDeleted).not.toHaveBeenCalled()
    toastError.mockRestore()
  })
})

describe('DocumentActionsMenu — renaming', () => {
  const renameRoute = (captured: Array<Record<string, unknown>>) =>
    http.patch('/api/documents/:id', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      captured.push(body)
      return HttpResponse.json({ id: 'doc-1', filename: DOCUMENT.filename, ...body })
    })

  it('edits the stem, keeps the extension, and reports the stored name upward', async () => {
    const captured: Array<Record<string, unknown>> = []
    server.use(renameRoute(captured))
    const onRenamed = vi.fn()
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" onRenamed={onRenamed} />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }))

    const field = await screen.findByLabelText('Name')
    expect(field).toHaveValue('Einreichplan_EG')
    expect(screen.getByTestId('rename-extension')).toHaveTextContent('.pdf')

    await user.clear(field)
    await user.type(field, 'Einreichplan Erdgeschoss')
    await user.click(screen.getByTestId('rename-submit'))

    await waitFor(() => expect(captured).toEqual([{ displayName: 'Einreichplan Erdgeschoss.pdf' }]))
    expect(onRenamed).toHaveBeenCalledWith('doc-1', 'Einreichplan Erdgeschoss.pdf')
  })

  it('refuses a name with a path separator before anything is sent', async () => {
    const captured: Array<Record<string, unknown>> = []
    server.use(renameRoute(captured))
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }))
    const field = await screen.findByLabelText('Name')
    await user.clear(field)
    await user.type(field, 'Pläne/EG')
    await user.click(screen.getByTestId('rename-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/slashes or line breaks/i)
    expect(captured).toEqual([])
    expect(screen.getByLabelText('Name')).toHaveValue('Pläne/EG')
  })

  it('offers to restore the original name, and only once there is one to restore', async () => {
    const captured: Array<Record<string, unknown>> = []
    server.use(renameRoute(captured))
    const user = userEvent.setup()
    const { rerender } = render(<DocumentActionsMenu document={DOCUMENT} scope="files" />)

    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }))
    expect(screen.queryByRole('button', { name: /restore original name/i })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    rerender(
      <DocumentActionsMenu
        document={{ ...DOCUMENT, displayName: 'Einreichplan Erdgeschoss.pdf' }}
        scope="files"
      />
    )
    await openMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }))
    await user.click(await screen.findByRole('button', { name: /restore original name/i }))

    await waitFor(() => expect(captured).toEqual([{ displayName: null }]))
  })

  describe('a document that failed to index', () => {
    const FAILED = { ...DOCUMENT, status: 'failed' }

    it('offers the retry where the failure is shown', async () => {
      const user = userEvent.setup()
      render(<DocumentActionsMenu document={FAILED} scope="files" />)
      await user.click(screen.getByTestId('document-actions-trigger'))

      expect(await screen.findByTestId('document-action-reingest')).toBeInTheDocument()
    })

    it('does not offer it for a document whose state is unknown', async () => {
      const user = userEvent.setup()
      render(<DocumentActionsMenu document={DOCUMENT} scope="files" />)
      await user.click(screen.getByTestId('document-actions-trigger'))

      expect(await screen.findByTestId('document-action-download')).toBeInTheDocument()
      expect(screen.queryByTestId('document-action-reingest')).not.toBeInTheDocument()
    })

    it('does not offer it to a reader who may not manage the document', async () => {
      const user = userEvent.setup()
      render(<DocumentActionsMenu document={FAILED} scope="files" canManage={false} />)
      await user.click(screen.getByTestId('document-actions-trigger'))

      expect(await screen.findByTestId('document-action-download')).toBeInTheDocument()
      expect(screen.queryByTestId('document-action-reingest')).not.toBeInTheDocument()
    })

    it('sends it back through ingestion and reports the new status', async () => {
      let asked = 0
      server.use(
        http.post('/api/documents/doc-1/reingest', () => {
          asked += 1
          return HttpResponse.json({ status: 'pending' })
        }),
      )
      const user = userEvent.setup()
      const onReingested = vi.fn()
      render(<DocumentActionsMenu document={FAILED} scope="files" onReingested={onReingested} />)

      await user.click(screen.getByTestId('document-actions-trigger'))
      await user.click(await screen.findByTestId('document-action-reingest'))

      await waitFor(() => expect(onReingested).toHaveBeenCalledWith('doc-1', 'pending'))
      expect(asked).toBe(1)
    })
  })
})

describe('DocumentActionsMenu — re-reading an indexed document', () => {
  const INDEXED = { ...DOCUMENT, status: 'completed' }

  it('asks first, then sends it through ingestion', async () => {
    let asked = 0
    server.use(
      http.post('/api/documents/doc-1/reingest', () => {
        asked += 1
        return HttpResponse.json({ status: 'pending' })
      }),
    )
    const user = userEvent.setup()
    const onReingested = vi.fn()
    render(<DocumentActionsMenu document={INDEXED} scope="officeShelf" onReingested={onReingested} />)

    await user.click(screen.getByTestId('document-actions-trigger'))
    await user.click(await screen.findByTestId('document-action-reingest'))

    expect(await screen.findByTestId('document-reingest-confirm')).toBeInTheDocument()
    expect(asked).toBe(0)

    await user.click(screen.getByTestId('document-reingest-confirm'))
    await waitFor(() => expect(onReingested).toHaveBeenCalledWith('doc-1', 'pending'))
    expect(asked).toBe(1)
  })

  it('does not offer it on an agent-authored document', async () => {
    const user = userEvent.setup()
    render(
      <DocumentActionsMenu document={{ ...INDEXED, authoredBy: 'agent' }} scope="files" />
    )
    await user.click(screen.getByTestId('document-actions-trigger'))

    expect(await screen.findByTestId('document-action-download')).toBeInTheDocument()
    expect(screen.queryByTestId('document-action-reingest')).not.toBeInTheDocument()
  })
})

describe('DocumentActionsMenu — moving between folders', () => {
  const FOLDERS = [
    { id: 'f-brand', name: 'Brandschutz', parentId: null },
    { id: 'f-flucht', name: 'Fluchtwege', parentId: 'f-brand' },
    { id: 'f-statik', name: 'Statik', parentId: null },
  ]

  const openMove = async (user: ReturnType<typeof userEvent.setup>) => {
    await openMenu(user)
    await user.click(await screen.findByTestId('document-action-move'))
  }

  it('is not offered when there is nowhere to move it to', async () => {
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" />)
    await openMenu(user)

    expect(screen.queryByTestId('document-action-move')).not.toBeInTheDocument()
  })

  it('names a nested folder by its whole path, not just its own name', async () => {
    const user = userEvent.setup()
    render(<DocumentActionsMenu document={DOCUMENT} scope="files" folders={FOLDERS} />)
    await openMove(user)

    expect(await screen.findByRole('menuitem', { name: /Brandschutz \/ Fluchtwege/ })).toBeInTheDocument()
  })

  it('offers the project root, and disables whichever folder it is already in', async () => {
    const user = userEvent.setup()
    render(
      <DocumentActionsMenu
        document={{ ...DOCUMENT, folderId: 'f-statik' }}
        scope="files"
        folders={FOLDERS}
        onMoved={vi.fn()}
      />,
    )
    await openMove(user)

    expect(await screen.findByRole('menuitem', { name: /^Statik$/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByTestId('document-move-root')).not.toHaveAttribute('aria-disabled', 'true')
  })

})
