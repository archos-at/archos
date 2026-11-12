/**
 * The project memory shelf draws its notes as folders by topic (ADR-0180): a
 * note sits under its topic's folder, a note without one under no topic, and a
 * reader who may not edit gets no action on a note or on a folder.
 */
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { makeMemoryItem } from '@/test-utils/db-fixtures'
import {
  ProjectMemoryTopicGroups,
  type MemoryItem,
  type ProjectMemoryNoteControls,
} from './project-memory-topic-groups'

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const note = (overrides: Parameters<typeof makeMemoryItem>[0]): MemoryItem => ({
  ...makeMemoryItem(overrides),
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-02T09:00:00Z',
  lastReferencedAt: null,
})

const controls = (): ProjectMemoryNoteControls => ({
  busyId: null,
  editingId: null,
  editDraft: '',
  onEditDraftChange: vi.fn(),
  onStartEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onSaveEdit: vi.fn(),
  onPatch: vi.fn(),
  onAskRemove: vi.fn(),
})

const items = [
  note({ id: 'fire', content: 'Fluchtweg Treppenhaus 2 offen.', topic: 'Brandschutz' }),
  note({ id: 'loose', content: 'Bauherr wünscht Abstimmung am Freitag.', topic: null }),
]

const restricted = (overrides: Parameters<typeof makeMemoryItem>[0]): MemoryItem =>
  note({ ...overrides, restrictedFolderIds: ['folder-1'] })

describe('ProjectMemoryTopicGroups', () => {
  test('files each note under its topic, and a note without one in its own folder', () => {
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={items}
        allItems={items}
        topics={[{ name: 'Brandschutz', count: 1 }]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.getAllByText('Brandschutz').length).toBeGreaterThan(0)
    expect(screen.getByText('Fluchtweg Treppenhaus 2 offen.')).toBeInTheDocument()
    expect(screen.getByText('Bauherr wünscht Abstimmung am Freitag.')).toBeInTheDocument()
  })

  test('a reader who may not change the shelf gets no edit, remove or topic action', () => {
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={items}
        allItems={items}
        topics={[{ name: 'Brandschutz', count: 1 }]}
        readOnly
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.getByText('Fluchtweg Treppenhaus 2 offen.')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /edit|remove|pin|move|rename|ungroup/i })).toHaveLength(0)
  })

  test('an edit asks the panel to start editing that note', async () => {
    const handlers = controls()
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={[items[0]]}
        allItems={[items[0]]}
        topics={[{ name: 'Brandschutz', count: 1 }]}
        readOnly={false}
        controls={handlers}
        onChanged={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(handlers.onStartEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'fire' }))
  })

  test('a folder of office notes only offers no rename or ungroup, as the project’s routes would move nothing', () => {
    const office = note({
      id: 'office',
      scope: 'organization',
      projectId: null,
      content: 'Büro: Die Bauordnung gilt für jedes Projekt.',
      topic: 'Bauordnung',
    })
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={[office]}
        allItems={[office]}
        topics={[{ name: 'Bauordnung', count: 1 }]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.getByText('Büro: Die Bauordnung gilt für jedes Projekt.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename topic' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ungroup' })).not.toBeInTheDocument()
  })

  test('a shelf with no topic on any note is grouped by kind, as before topics', () => {
    const decision = note({ id: 'd', kind: 'decision', content: 'Dach wird gedämmt.', topic: null })
    const constraint = note({ id: 'c', kind: 'constraint', content: 'Max. 9 m Gebäudehöhe.', topic: null })
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={[constraint, decision]}
        allItems={[constraint, decision]}
        topics={[]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.getByTestId('kind-groups')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-folders')).not.toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Decisions', 'Constraints'])
  })

  test('an open note offers only the topics open notes hold, a restricted note every topic its reader sees', async () => {
    const open = note({ id: 'fire', content: 'Fluchtweg offen.', topic: 'Brandschutz' })
    const secret = restricted({ id: 'secret', content: 'Bauherr: Vertraulich.', topic: 'Bauherr' })
    const shelf = [open, secret]
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={shelf}
        allItems={shelf}
        topics={[
          { name: 'Brandschutz', count: 1 },
          { name: 'Bauherr', count: 1 },
        ]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    const triggers = screen.getAllByRole('button', { name: 'Move to …' })
    await userEvent.click(triggers[0])
    const openList = await screen.findByRole('listbox', { name: 'Move to …' })
    expect(within(openList).getByRole('option', { name: 'Brandschutz' })).toBeInTheDocument()
    expect(within(openList).queryByRole('option', { name: 'Bauherr' })).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Move to …' })[1])
    const restrictedList = await screen.findByRole('listbox', { name: 'Move to …' })
    expect(within(restrictedList).getByRole('option', { name: 'Bauherr' })).toBeInTheDocument()
    expect(within(restrictedList).getByRole('option', { name: 'Brandschutz' })).toBeInTheDocument()
  })

  test('the rename dialog merges only into topics open notes hold, never a restricted topic’s name', async () => {
    const open = note({ id: 'fire', content: 'Fluchtweg offen.', topic: 'Brandschutz' })
    const other = note({ id: 'park', content: 'Stellplatz 3.', topic: 'Stellplätze' })
    const secret = restricted({ id: 'secret', content: 'Bauherr: Vertraulich.', topic: 'Bauherr' })
    const shelf = [open, other, secret]
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={shelf}
        allItems={shelf}
        topics={[
          { name: 'Brandschutz', count: 1 },
          { name: 'Stellplätze', count: 1 },
          { name: 'Bauherr', count: 1 },
        ]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Rename topic' })[0])
    await userEvent.click(screen.getByLabelText('Topic name'))

    const options = await screen.findByRole('listbox', { name: 'Topic name' })
    expect(within(options).getByRole('option', { name: 'Stellplätze' })).toBeInTheDocument()
    expect(within(options).queryByRole('option', { name: 'Bauherr' })).not.toBeInTheDocument()
    expect(within(options).queryByRole('option', { name: 'Brandschutz' })).not.toBeInTheDocument()
  })
})
