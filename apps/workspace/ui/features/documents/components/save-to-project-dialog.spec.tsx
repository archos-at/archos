import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { SaveToProjectDialog, nameStem, type SaveToProjectDialogProps } from './save-to-project-dialog'

const FOLDERS_URL = '/api/projects/proj-1/folders'

const FOLDERS = [
  { id: 'f-plan', name: 'Planung', parentId: null, path: 'Planung', access: 'write' },
  { id: 'f-stat', name: 'Statik', parentId: 'f-plan', path: 'Planung/Statik', access: 'write' },
  { id: 'f-vert', name: 'Verträge', parentId: null, path: 'Verträge', access: 'read' },
]

const created: unknown[] = []

function Dialog(props: Partial<SaveToProjectDialogProps> = {}) {
  return (
    <SaveToProjectDialog
      open
      onOpenChange={vi.fn()}
      projectId="proj-1"
      fileName="Flächenaufstellung.xlsx"
      extension="xlsx"
      onSave={vi.fn()}
      {...props}
    />
  )
}

async function ready(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('save-to-project-submit')).not.toHaveAttribute('aria-disabled'))
}

beforeEach(() => {
  created.length = 0
  server.use(
    http.get(FOLDERS_URL, () => HttpResponse.json({ folders: FOLDERS, rootAccess: 'write' })),
    http.post(FOLDERS_URL, async ({ request }) => {
      const body = (await request.json()) as { name: string; parentId?: string }
      created.push(body)
      if (body.name === 'Planung') {
        return HttpResponse.json({ error: 'taken', details: { reason: 'folder-name-taken' } }, { status: 409 })
      }
      return HttpResponse.json(
        { folder: { id: 'f-new', name: body.name, parentId: body.parentId ?? null, path: body.name } },
        { status: 201 },
      )
    }),
  )
})

describe('SaveToProjectDialog', () => {
  it('prefills the name without its extension and shows the extension beside it, fixed', async () => {
    render(<Dialog />)
    await ready()

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Flächenaufstellung')
    expect(screen.getByTestId('save-to-project-extension')).toHaveTextContent('.xlsx')
  })

  it('starts at the project root and lists its folders, read-only ones marked', async () => {
    render(<Dialog />)
    await ready()

    expect(screen.getByTestId('save-to-project-here')).toHaveTextContent('All Files')
    const list = screen.getByRole('list', { name: 'Folders in “All Files”' })
    expect(within(list).getByRole('button', { name: 'Open folder “Planung”' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Open folder “Verträge”' })).toHaveTextContent('Read only')
    expect(within(list).queryByText('Statik')).not.toBeInTheDocument()
  })

  it('files at the root under the prefilled name when nothing is changed', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Dialog onSave={onSave} />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'File' }))

    expect(onSave).toHaveBeenCalledWith({ folderId: null, folderLabel: 'All Files', name: 'Flächenaufstellung.xlsx' })
  })

  it('opens a folder, then a folder inside it, and files there', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Dialog onSave={onSave} />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Open folder “Planung”' }))
    await user.click(screen.getByRole('button', { name: 'Open folder “Statik”' }))
    expect(screen.getByTestId('save-to-project-here')).toHaveTextContent('Statik')
    expect(screen.getByText('There are no further folders here.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'File' }))

    expect(onSave).toHaveBeenCalledWith({ folderId: 'f-stat', folderLabel: 'Planung / Statik', name: 'Flächenaufstellung.xlsx' })
  })

  it('goes back up through the breadcrumb', async () => {
    const user = userEvent.setup()
    render(<Dialog />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Open folder “Planung”' }))
    await user.click(screen.getByRole('button', { name: 'Open folder “Statik”' }))
    await user.click(screen.getByRole('button', { name: 'Planung' }))
    expect(screen.getByTestId('save-to-project-here')).toHaveTextContent('Planung')
    await user.click(screen.getByRole('button', { name: 'All Files' }))
    expect(screen.getByTestId('save-to-project-here')).toHaveTextContent('All Files')
  })

  it('renames the file and keeps its extension, even when the extension is typed again', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Dialog onSave={onSave} />)
    await ready()

    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Flächen EG.xlsx{Enter}')

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Flächen EG.xlsx' }))

    await user.clear(name)
    await user.type(name, 'Flächen OG.docx{Enter}')
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Flächen OG.docx.xlsx' }))
  })

  it('refuses an empty name and a name with a slash, and files nothing', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Dialog onSave={onSave} />)
    await ready()

    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a name.')

    await user.type(name, 'Plan/EG')
    await user.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Slashes and control characters cannot be part of the name.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('will not file into a folder the reader may only read', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Dialog onSave={onSave} />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Open folder “Verträge”' }))

    expect(screen.getByTestId('save-to-project-read-only')).toHaveTextContent('You may only read “Verträge”.')
    expect(screen.getByTestId('save-to-project-submit')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTestId('save-to-project-new-folder')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('save-to-project-submit'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('makes a new folder where it stands and moves into it', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Dialog onSave={onSave} />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Open folder “Planung”' }))
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'Name of the new folder' }), 'Flächen{Enter}')

    await waitFor(() => expect(screen.getByTestId('save-to-project-here')).toHaveTextContent('Flächen'))
    expect(created).toEqual([{ name: 'Flächen', parentId: 'f-plan' }])
    await user.click(screen.getByRole('button', { name: 'File' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f-new', folderLabel: 'Planung / Flächen' }))
  })

  it('says when the new folder’s name is taken, and stays where it was', async () => {
    const user = userEvent.setup()
    render(<Dialog />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'Name of the new folder' }), 'Planung{Enter}')

    expect(await screen.findByText('“All Files” already has a folder “Planung”.')).toBeInTheDocument()
    expect(screen.getByTestId('save-to-project-here')).toHaveTextContent('All Files')
  })

  it('offers a retry when the folders do not load', async () => {
    server.use(http.get(FOLDERS_URL, () => HttpResponse.json({ error: 'down' }, { status: 502 })))
    const user = userEvent.setup()
    render(<Dialog />)

    expect(await screen.findByText('The folders could not be loaded.')).toBeInTheDocument()
    expect(screen.getByTestId('save-to-project-submit')).toHaveAttribute('aria-disabled', 'true')

    server.use(http.get(FOLDERS_URL, () => HttpResponse.json({ folders: FOLDERS, rootAccess: 'write' })))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await ready()
  })

  it('shows the filing error it is given', async () => {
    render(<Dialog error="Filing failed. Please try again." />)
    await ready()

    expect(screen.getByTestId('save-to-project-error')).toHaveTextContent('Filing failed. Please try again.')
  })
})

describe('nameStem', () => {
  it('drops the extension once, whatever its case, and leaves any other name alone', () => {
    expect(nameStem('Plan.XLSX', 'xlsx')).toBe('Plan')
    expect(nameStem('Plan.docx', 'xlsx')).toBe('Plan.docx')
    expect(nameStem('  Plan  ', 'xlsx')).toBe('Plan')
  })
})
