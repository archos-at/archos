/**
 * The Project Memory panel marks a restricted note (ADR-0087) with the folder
 * lock, naming the folders it came from. The API sends such a note only to a
 * reader cleared for it, so the panel's job is the mark, not the filter. When a
 * language model helped decide who reads the note, the mark says so (AI Act).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import { makeMemoryItem } from '@/test-utils/db-fixtures'
import { ProjectMemoryPanel } from './project-memory-panel'

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const wire = (overrides: Parameters<typeof makeMemoryItem>[0] & { restrictedFolderNames?: string[] }) => ({
  ...makeMemoryItem(overrides),
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-02T09:00:00Z',
  lastReferencedAt: null,
  ...(overrides.restrictedFolderNames ? { restrictedFolderNames: overrides.restrictedFolderNames } : {}),
})

describe('ProjectMemoryPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          topics: [],
          items: [
            wire({ id: 'open', content: 'Flachdach extensiv begrünt.' }),
            wire({
              id: 'restricted',
              content: 'Honorar LP 5–8 pauschal 184.000 €.',
              restrictedFolderIds: ['aaaaaaaa-0000-4000-8000-000000000001'],
              restrictedFolderNames: ['Verträge'],
            }),
            wire({
              id: 'judged',
              content: 'Gehaltsrahmen Bauleitung abgestimmt.',
              restrictedFolderIds: ['aaaaaaaa-0000-4000-8000-000000000002'],
              restrictedFolderNames: ['Personal'],
              restrictionJudge: 'drawn',
            }),
          ],
        })
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('marks only the restricted note, naming its folder', async () => {
    render(<ProjectMemoryPanel projectId="p1" />)

    await screen.findByText('Honorar LP 5–8 pauschal 184.000 €.')
    const marks = screen.getAllByTestId('memory-restricted')
    expect(marks).toHaveLength(2)
    expect(marks[0].querySelector('[data-names]')?.getAttribute('data-names')).toBe('Verträge')
    expect(screen.getByText('Flachdach extensiv begrünt.')).toBeInTheDocument()
  })

  test('files the notes under the topics the shelf names, with the count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          topics: [{ name: 'Brandschutz', count: 1 }],
          items: [wire({ id: 'fire', content: 'Fluchtweg Treppenhaus 2 offen.', topic: 'Brandschutz' })],
        })
      )
    )
    render(<ProjectMemoryPanel projectId="p1" />)

    await screen.findByText('Fluchtweg Treppenhaus 2 offen.')
    expect(screen.getAllByText('Brandschutz').length).toBeGreaterThan(0)
  })

  test('a closed project: the notes, and no control that would change them (ADR-0090)', async () => {
    render(<ProjectMemoryPanel projectId="p1" readOnly />)

    await screen.findByText('Flachdach extensiv begrünt.')
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /edit|remove|pin/i })).toHaveLength(0)
  })

  test('an active project keeps them', async () => {
    render(<ProjectMemoryPanel projectId="p1" />)

    await screen.findByText('Flachdach extensiv begrünt.')
    expect(screen.getAllByRole('button', { name: /edit/i }).length).toBeGreaterThan(0)
  })

  test('says under its heading who reads these notes (ADR-0180)', async () => {
    render(<ProjectMemoryPanel projectId="p1" readOnly />)

    await screen.findByText('Flachdach extensiv begrünt.')
    expect(screen.getByTestId('memory-audience')).toHaveTextContent('Every member of this project sees these notes.')
  })

  test('shows the confidence as a word, never the stored token', async () => {
    render(<ProjectMemoryPanel projectId="p1" />)

    await screen.findByText('Flachdach extensiv begrünt.')
    expect(screen.getAllByText(/Confidence: medium/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/medium confidence/)).not.toBeInTheDocument()
  })

  test('a confidence this build does not know is shown as it is', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ topics: [], items: [wire({ id: 'odd', content: 'Sonderfall.', confidence: 'certain' as 'high' })] }))
    )
    render(<ProjectMemoryPanel projectId="p1" />)

    await screen.findByText('Sonderfall.')
    expect(screen.getByText(/certain/)).toBeInTheDocument()
  })

  test('says on the lock when a language model helped decide who reads the note, and only there', async () => {
    render(<ProjectMemoryPanel projectId="p1" />)

    await screen.findByText('Gehaltsrahmen Bauleitung abgestimmt.')
    const judged = screen.getAllByTestId('memory-restriction-judged')
    expect(judged).toHaveLength(1)
    const mark = judged[0].closest('[data-testid="memory-restricted"]')
    expect(mark?.textContent).toContain('decided with AI')
    expect(mark?.querySelector('[data-names]')?.getAttribute('data-names')).toBe('Personal')
  })

  test('a note refused for a phone number says so in the person\'s language, not as a status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json(
              { error: 'A note in shared memory cannot hold a phone number.', code: 'BAD_REQUEST', details: { reason: 'note_refused', kind: 'phone' } },
              { status: 400 }
            )
          : Response.json({ topics: [], items: [] })
      )
    )
    render(<ProjectMemoryPanel projectId="proj-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Add note'), 'Bauherr: 0664 1234567')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(
      await screen.findByText('Not saved: a note others read may not hold a phone number. Leave it out and save again.')
    ).toBeInTheDocument()
  })

  test('a new note is filed under the open topic picked for it', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ item: wire({ id: 'new', content: 'Brandschutzkonzept abgestimmt.', topic: 'Brandschutz' }) })
        : Response.json({
            topics: [{ name: 'Brandschutz', count: 1 }],
            items: [wire({ id: 'fire', content: 'Fluchtweg Treppenhaus 2 offen.', topic: 'Brandschutz' })],
          })
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ProjectMemoryPanel projectId="p1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Add note'), 'Brandschutzkonzept abgestimmt.')
    await userEvent.type(screen.getByRole('combobox', { name: 'Topic' }), 'brand')
    await userEvent.click(screen.getByRole('option', { name: 'Brandschutz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('Brandschutzkonzept abgestimmt.')
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body))).toEqual({
      kind: 'decision',
      content: 'Brandschutzkonzept abgestimmt.',
      topic: 'Brandschutz',
    })
  })

  test('switching a new note to the office drops the project topic picked for it', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ item: wire({ id: 'new', content: 'Gilt im ganzen Büro.', scope: 'organization', projectId: null }) })
        : Response.json({
            topics: [{ name: 'Stellplätze', count: 1 }],
            items: [wire({ id: 'park', content: 'Tiefgarage mit 40 Plätzen.', topic: 'Stellplätze' })],
          })
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ProjectMemoryPanel projectId="p1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }))
    await userEvent.type(screen.getByLabelText('Add note'), 'Gilt im ganzen Büro.')
    await userEvent.type(screen.getByRole('combobox', { name: 'Topic' }), 'stell')
    await userEvent.click(screen.getByRole('option', { name: 'Stellplätze' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Scope of the note' }))
    await userEvent.click(await screen.findByRole('option', { name: 'All my projects' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('Gilt im ganzen Büro.')
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(String(post?.[0])).toContain('/api/organization/memory')
    expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body)).topic ?? null).toBeNull()
  })
})
