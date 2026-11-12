/**
 * „Mein Gedächtnis“ (ADR-0180): the person's own notes. What must hold: the
 * page says who reads them before anything else, the list keeps the server's
 * order (pinned first), every state has a face (loading, empty, failed), and
 * an edit another note already says (409) keeps the editor open with the
 * reason instead of losing what was typed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@/test-utils'
import { toast } from 'sonner'
import { PersonalMemoryPanel } from './personal-memory-panel'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const note = (id: string, content: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: 'preference',
  content,
  provenanceType: 'agent',
  topic: null,
  pinned: false,
  sourceConversationId: null,
  createdAt: '2026-11-01T09:00:00Z',
  updatedAt: '2026-11-01T09:00:00Z',
  ...overrides,
})

const PINNED = note('n-pinned', 'Antworten bitte knapp.', { pinned: true, provenanceType: 'user' })
const NEWER = note('n-newer', 'Leitet die Einreichplanung.', { kind: 'profile', updatedAt: '2026-11-09T09:00:00Z' })
const OLDER = note('n-older', 'Flächen in Quadratmetern.', { provenanceType: 'distillation' })

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
const fetchMock = vi.fn<Handler>()

/** Answer the list with `items`, and every other request with `rest`. */
function serve(items: unknown[], rest: Handler = () => new Response(null, { status: 204 })): void {
  fetchMock.mockImplementation((url, init) =>
    !init?.method ? Response.json({ items, nextCursor: null }) : rest(url, init)
  )
}

const rows = (): string[] => screen.getAllByTestId('personal-memory-note').map((row) => row.textContent ?? '')

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PersonalMemoryPanel', () => {
  test('opens with who reads these notes: only the person', async () => {
    serve([PINNED])
    render(<PersonalMemoryPanel />)

    expect(screen.getByTestId('personal-memory-audience')).toHaveTextContent(
      'Only you see these notes, neither colleagues nor the administrators of your office.'
    )
    await screen.findByText('Antworten bitte knapp.')
  })

  test('lists the notes as the server orders them, each with its kind and where it came from', async () => {
    serve([PINNED, NEWER, OLDER])
    render(<PersonalMemoryPanel />)

    await screen.findByText('Antworten bitte knapp.')
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory?limit=200')
    const [first, second, third] = rows()
    expect(first).toContain('Antworten bitte knapp.')
    expect(first).toContain('added by you')
    expect(second).toContain('Role and topics')
    expect(third).toContain('after an answer')
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument()
  })

  test('notes are folded by topic: the topics most notes first, the notes without a topic last', async () => {
    serve([
      note('n-plain', 'Ohne Thema.'),
      note('n-one', 'Stellplatz 3.', { topic: 'Stellplätze' }),
      note('n-two', 'Brandschutzklasse F30.', { topic: 'Brandschutz' }),
      note('n-three', 'Fluchtweg Nord.', { topic: 'Brandschutz' }),
    ])
    render(<PersonalMemoryPanel />)

    await screen.findByText('Stellplatz 3.')
    const [fireSafety, parking, unfiled] = screen.getAllByTestId('topic-folder')
    expect(fireSafety).toHaveTextContent('Brandschutz2 notes')
    expect(parking).toHaveTextContent('Stellplätze1 note')
    expect(unfiled).toHaveTextContent('No topic')
    expect(rows()).toHaveLength(4)
  })

  test('shows the loading rows until the list answers', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    render(<PersonalMemoryPanel />)

    expect(screen.getByTestId('memory-list-loading')).toBeInTheDocument()
  })

  test('an empty memory says what will be kept here', async () => {
    serve([])
    render(<PersonalMemoryPanel />)

    expect(await screen.findByText('No notes yet')).toBeInTheDocument()
  })

  test('a failed load says so and loads again on retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))
    render(<PersonalMemoryPanel />)

    expect(await screen.findByText('The notes could not be loaded')).toBeInTheDocument()
    serve([PINNED])
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Antworten bitte knapp.')).toBeInTheDocument()
  })

  test('adds a note with its kind and puts it into the list', async () => {
    const created = note('n-new', 'Ist für Brandschutz zuständig.', { kind: 'profile', provenanceType: 'user', updatedAt: '2026-11-11T09:00:00Z' })
    serve([OLDER], () => Response.json({ item: created, created: true }, { status: 201 }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Note'), '  Ist für Brandschutz zuständig.  ')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('Ist für Brandschutz zuständig.')
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preference', content: 'Ist für Brandschutz zuständig.', topic: null }),
    })
    expect(rows()[0]).toContain('Ist für Brandschutz zuständig.')
    expect(toast.success).toHaveBeenCalledWith('Note added.')
  })

  test('a note added under a topic is sent with it, the topic the shelf already has', async () => {
    const created = note('n-new', 'Brandschutzklasse F30.', { topic: 'Brandschutz', provenanceType: 'user' })
    serve([note('n-one', 'Fluchtweg Nord.', { topic: 'Brandschutz' })], () =>
      Response.json({ item: created, created: true }, { status: 201 })
    )
    render(<PersonalMemoryPanel />)
    await screen.findByText('Fluchtweg Nord.')

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Note'), 'Brandschutzklasse F30.')
    await userEvent.type(screen.getByRole('combobox', { name: 'Topic' }), 'brand')
    await userEvent.click(screen.getByRole('option', { name: 'Brandschutz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('Brandschutzklasse F30.')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user/memory',
      expect.objectContaining({
        body: JSON.stringify({ kind: 'preference', content: 'Brandschutzklasse F30.', topic: 'Brandschutz' }),
      })
    )
  })

  test('a text an existing note already says answers that note: the list holds it once', async () => {
    serve([OLDER], () => Response.json({ item: { ...OLDER, updatedAt: '2026-11-11T09:00:00Z' }, created: false }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Note'), 'Flächen in Quadratmetern.')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.queryByLabelText('Note')).not.toBeInTheDocument())
    expect(rows()).toHaveLength(1)
    // Nothing was added, and the panel does not claim it was.
    expect(toast.success).toHaveBeenCalledWith('You already have this note. It is back at the top.')
    expect(toast.success).not.toHaveBeenCalledWith('Note added.')
  })

  test('pinning moves the note to the front', async () => {
    serve([NEWER, OLDER], () => Response.json({ item: { ...OLDER, pinned: true } }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    const older = screen.getAllByTestId('personal-memory-note')[1]
    await userEvent.click(within(older).getByRole('button', { name: 'Pin' }))

    await waitFor(() => expect(rows()[0]).toContain('Flächen in Quadratmetern.'))
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory/n-older', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
  })

  test('saves an edit and closes the editor', async () => {
    serve([OLDER], () => Response.json({ item: { ...OLDER, content: 'Flächen in m² mit einer Nachkommastelle.' } }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Edit note')
    await userEvent.clear(field)
    await userEvent.type(field, 'Flächen in m² mit einer Nachkommastelle.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Flächen in m² mit einer Nachkommastelle.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit note')).not.toBeInTheDocument()
  })

  test('409 on an edit: the editor stays open with the text and says another note already says it', async () => {
    serve([NEWER, OLDER], () => Response.json({ error: 'Another personal note already says this' }, { status: 409 }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    const older = screen.getAllByTestId('personal-memory-note')[1]
    await userEvent.click(within(older).getByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Edit note')
    await userEvent.clear(field)
    await userEvent.type(field, 'Leitet die Einreichplanung.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Another note already says this.')
    expect(screen.getByLabelText('Edit note')).toHaveValue('Leitet die Einreichplanung.')
    expect(screen.getByLabelText('Edit note')).toHaveAttribute('aria-invalid', 'true')
  })

  test('any other failed edit keeps the editor open too, with its own reason', async () => {
    serve([OLDER], () => new Response('nope', { status: 500 }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Edit note'), ' Neu.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The note was not saved. Try again.')
  })

  test('a note refused as a secret says what it held, in the person\'s language; an unknown kind keeps the generic text', async () => {
    const refusal = (kind: string) => () =>
      Response.json(
        { error: 'A memory note cannot hold a password or access code.', code: 'BAD_REQUEST', details: { reason: 'note_refused', kind } },
        { status: 400 }
      )
    serve([OLDER], refusal('credential'))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Note'), 'WLAN-Passwort: Sommer2026!')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Not saved: a note may not hold a password or access code. Leave it out and save again.'
      )
    )

    serve([OLDER], refusal('a_kind_from_the_future'))
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Edit note'), ' Neu.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The note was not saved. Try again.')
  })

  test('removes a note only after the confirmation', async () => {
    serve([NEWER, OLDER])
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    const older = screen.getAllByTestId('personal-memory-note')[1]
    await userEvent.click(within(older).getByRole('button', { name: 'Remove' }))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/user/memory/n-older', { method: 'DELETE' })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Remove note?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.queryByText('Flächen in Quadratmetern.')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory/n-older', { method: 'DELETE' })
    expect(screen.getByText('Leitet die Einreichplanung.')).toBeInTheDocument()
  })

  test('offers „remove all“ only where there are notes', async () => {
    serve([])
    render(<PersonalMemoryPanel />)
    await screen.findByText('No notes yet')
    expect(screen.queryByRole('button', { name: 'Remove all notes' })).not.toBeInTheDocument()
  })

  test('removes every note only after a confirmation that says how many and that it cannot be undone', async () => {
    serve([PINNED, NEWER, OLDER], () => Response.json({ removed: 3 }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Remove all notes' }))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/user/memory', { method: 'DELETE' })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Remove all notes?')
    expect(dialog).toHaveTextContent('3 notes are removed from your memory, pinned ones included.')
    expect(dialog).toHaveTextContent('This cannot be undone.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove all notes' }))

    expect(await screen.findByText('No notes yet')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory', { method: 'DELETE' })
    expect(screen.queryAllByTestId('personal-memory-note')).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith('3 notes removed.')
  })

  test('one note is counted in the singular, and cancelling removes nothing', async () => {
    serve([NEWER])
    render(<PersonalMemoryPanel />)
    await screen.findByText('Leitet die Einreichplanung.')

    await userEvent.click(screen.getByRole('button', { name: 'Remove all notes' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('1 note is removed from your memory')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalledWith('/api/user/memory', { method: 'DELETE' })
    expect(screen.getByText('Leitet die Einreichplanung.')).toBeInTheDocument()
  })

  test('a refused „remove all“ keeps the list and says so', async () => {
    serve([NEWER, OLDER], () => new Response('down', { status: 502 }))
    render(<PersonalMemoryPanel />)
    await screen.findByText('Flächen in Quadratmetern.')

    await userEvent.click(screen.getByRole('button', { name: 'Remove all notes' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove all notes' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The notes were not removed. Try again.'))
    expect(rows()).toHaveLength(2)
  })
})
