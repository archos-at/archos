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
  pickableTopicNames,
  type MemoryItem,
  type ProjectMemoryNoteControls,
} from './project-memory-topic-groups'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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

    await userEvent.click(screen.getAllByRole('button', { name: 'Move to …' })[0])
    const openField = await screen.findByRole('combobox', { name: 'Move to …' })
    await userEvent.clear(openField)
    const openList = await screen.findByRole('listbox', { name: 'Move to …' })
    expect(within(openList).getByRole('option', { name: 'Brandschutz' })).toBeInTheDocument()
    expect(within(openList).queryByRole('option', { name: 'Bauherr' })).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Move to …' })[1])
    const restrictedField = await screen.findByRole('combobox', { name: 'Move to …' })
    await userEvent.clear(restrictedField)
    const restrictedList = await screen.findByRole('listbox', { name: 'Move to …' })
    expect(within(restrictedList).getByRole('option', { name: 'Bauherr' })).toBeInTheDocument()
    expect(within(restrictedList).getByRole('option', { name: 'Brandschutz' })).toBeInTheDocument()
  })

  test('an office note’s move picker offers only the topics office notes hold, never a project’s', async () => {
    const office = note({
      id: 'office',
      scope: 'organization',
      projectId: null,
      content: 'Büro: Die Bauordnung gilt für jedes Projekt.',
      topic: 'Bauordnung',
    })
    const project = note({ id: 'fire', content: 'Fluchtweg offen.', topic: 'Brandschutz' })
    const shelf = [office, project]
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={shelf}
        allItems={shelf}
        topics={[
          { name: 'Bauordnung', count: 1 },
          { name: 'Brandschutz', count: 1 },
        ]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    const folder = screen
      .getAllByTestId('topic-folder')
      .find((element) => within(element).queryByText('Büro: Die Bauordnung gilt für jedes Projekt.'))
    expect(folder).toBeDefined()
    await userEvent.click(within(folder!).getByRole('button', { name: 'Move to …' }))
    await userEvent.clear(await screen.findByRole('combobox', { name: 'Move to …' }))

    const list = await screen.findByRole('listbox', { name: 'Move to …' })
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['No topic', 'Bauordnung'])
  })

  test('the rename dialog says a folder with office notes keeps their topic', async () => {
    const office = note({
      id: 'office',
      scope: 'organization',
      projectId: null,
      content: 'Büro: Die Bauordnung gilt für jedes Projekt.',
      topic: 'Bauordnung',
    })
    const project = note({ id: 'bau', content: 'Bauantrag eingereicht.', topic: 'Bauordnung' })
    const shelf = [office, project]
    render(
      <ProjectMemoryTopicGroups
        projectId="p1"
        items={shelf}
        allItems={shelf}
        topics={[{ name: 'Bauordnung', count: 2 }]}
        readOnly={false}
        controls={controls()}
        onChanged={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))

    expect(await screen.findByText("The office's notes keep their topic.")).toBeInTheDocument()
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

    const options = await screen.findByRole('listbox', { name: 'Rename topic' })
    expect(within(options).getByRole('option', { name: 'Stellplätze' })).toBeInTheDocument()
    expect(within(options).queryByRole('option', { name: 'Bauherr' })).not.toBeInTheDocument()
    expect(within(options).queryByRole('option', { name: 'Brandschutz' })).not.toBeInTheDocument()
  })
})

describe('pickableTopicNames', () => {
  const openProject = note({ id: 'a', content: 'a', topic: 'Brandschutz' })
  const openOffice = note({ id: 'b', content: 'b', scope: 'organization', projectId: null, topic: 'Bauordnung' })
  const restrictedOffice = restricted({
    id: 'c',
    content: 'c',
    scope: 'organization',
    projectId: null,
    topic: 'Vertraulich',
  })
  const shelf = [openProject, openOffice, restrictedOffice]
  const visible = ['Brandschutz', 'Bauordnung', 'Vertraulich']

  test('an open office note takes only the topics open office notes hold', () => {
    expect(pickableTopicNames(shelf, { scope: 'organization', restricted: false }, visible)).toEqual(['Bauordnung'])
  })

  test('a restricted office note takes the topics the office notes of the list hold, restricted ones included', () => {
    expect(pickableTopicNames(shelf, { scope: 'organization', restricted: true }, visible).sort()).toEqual([
      'Bauordnung',
      'Vertraulich',
    ])
  })

  test('an open project note takes the topics of the open notes of the list, office ones included', () => {
    expect(pickableTopicNames(shelf, { scope: 'project', restricted: false }, visible).sort()).toEqual([
      'Bauordnung',
      'Brandschutz',
    ])
  })

  test('a restricted project note takes every topic the reader sees', () => {
    expect(pickableTopicNames(shelf, { scope: 'project', restricted: true }, visible)).toEqual(visible)
  })
})
