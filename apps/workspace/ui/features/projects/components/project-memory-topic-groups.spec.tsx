/**
 * The project memory shelf draws its notes as folders by topic (ADR-0180): a
 * note sits under its topic's folder, a note without one under no topic, and a
 * reader who may not edit gets no action on a note or on a folder.
 */
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
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
})
