/**
 * The actions on a personal topic (ADR-0180): what must hold is that each
 * write goes to the person's own topic routes with the names the list shows,
 * that a removal says how many notes it deletes before it deletes them, that a
 * refused write changes nothing and says so, and that the no-topic group has
 * no actions at all.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@/test-utils'
import { toast } from 'sonner'
import {
  removePersonalMemoryTopic,
  renamePersonalMemoryTopic,
  updatePersonalMemoryNote,
} from '@/adapters/api/personal-memory-client'
import { ApiRequestError } from '@/adapters/api/api-error'
import { PersonalNoteTopicMove, PersonalTopicActions } from './personal-topic-actions'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/adapters/api/personal-memory-client', () => ({
  renamePersonalMemoryTopic: vi.fn(),
  removePersonalMemoryTopic: vi.fn(),
  updatePersonalMemoryNote: vi.fn(),
}))

const renameMock = vi.mocked(renamePersonalMemoryTopic)
const removeMock = vi.mocked(removePersonalMemoryTopic)
const updateNoteMock = vi.mocked(updatePersonalMemoryNote)

const NOTE = {
  id: 'n-1',
  kind: 'preference' as const,
  content: 'Antworten bitte knapp.',
  provenanceType: 'user' as const,
  pinned: false,
  topic: null,
  sourceConversationId: null,
  createdAt: '2026-11-10T08:00:00Z',
  updatedAt: '2026-11-10T08:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  renameMock.mockResolvedValue({ moved: 1 })
  removeMock.mockResolvedValue({ removed: 1 })
  updateNoteMock.mockResolvedValue({ item: NOTE })
})

describe('PersonalTopicActions', () => {
  test('the no-topic group has nothing to rename, ungroup or remove', () => {
    render(<PersonalTopicActions topic={null} count={2} topics={[]} onChanged={vi.fn()} />)

    expect(screen.queryByTestId('personal-topic-actions')).not.toBeInTheDocument()
  })

  test('renaming a topic sends the new name to the topic route and reads the list again', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    const input = screen.getByLabelText('Topic name')
    expect(input).toHaveValue('Brandschutz')
    await userEvent.clear(input)
    await userEvent.type(input, 'Brand  und Rauch')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(renameMock).toHaveBeenCalledWith({ from: 'Brandschutz', to: 'Brand und Rauch' })
  })

  test('a name over the topic bound is refused on the screen and sends nothing', async () => {
    render(<PersonalTopicActions topic="Brandschutz" count={3} topics={['Brandschutz']} onChanged={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    await userEvent.clear(screen.getByLabelText('Topic name'))
    await userEvent.type(screen.getByLabelText('Topic name'), 'x'.repeat(41))

    expect(screen.getByText('At most 40 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(renameMock).not.toHaveBeenCalled()
  })

  test('the same topic name is no change and sends nothing', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(renameMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('a case-only change of a topic is a rename the server takes', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="brandschutz" count={3} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    // The field is a combobox; its option list is labelled the same, so the field is asked for by role.
    await userEvent.clear(screen.getByRole('combobox', { name: 'Topic name' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Topic name' }), 'Brandschutz')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(renameMock).toHaveBeenCalledWith({ from: 'brandschutz', to: 'Brandschutz' })
  })

  test('ungrouping sends no topic for the notes, which keep their text', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(renameMock).toHaveBeenCalledWith({ from: 'Brandschutz', to: null })
  })

  test('removing a topic says how many notes go before it deletes them', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Remove topic and all its notes' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('3 notes in "Brandschutz" are removed for good.')).toBeInTheDocument()
    expect(removeMock).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove topic and all its notes' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(removeMock).toHaveBeenCalledWith('Brandschutz')
  })

  test('a refused write says so, changes nothing on the screen and reads nothing again', async () => {
    renameMock.mockRejectedValue(new ApiRequestError('Failed to rename topic in personal memory: 500', 500))
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The note was not saved. Try again.'))
    expect(onChanged).not.toHaveBeenCalled()
  })
})

describe('PersonalNoteTopicMove', () => {
  test('moving a note PATCHes its own item with the topic the person picked', async () => {
    const onChanged = vi.fn()
    render(<PersonalNoteTopicMove item={{ id: 'n-1', topic: null }} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Move to …' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Topic' }), 'brand')
    await userEvent.click(screen.getByRole('option', { name: 'Brandschutz' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(updateNoteMock).toHaveBeenCalledWith('n-1', { topic: 'Brandschutz' })
  })
})
