/**
 * The actions on a personal topic (ADR-0180): what must hold is that each
 * write goes to the person's own topic routes with the names the list shows,
 * that a removal says how many notes it deletes before it deletes them, that a
 * refused write changes nothing and says so, and that the no-topic group has
 * no actions at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@/test-utils'
import { toast } from 'sonner'
import { PersonalNoteTopicMove, PersonalTopicActions } from './personal-topic-actions'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
const fetchMock = vi.fn<Handler>()
const ok = (): Response => new Response(null, { status: 200 })

/** The body of the request made to `url` with `method`, parsed. */
const sentTo = (url: string, method: string): unknown => {
  const call = fetchMock.mock.calls.find(([called, init]) => called === url && init?.method === method)
  expect(call, `${method} ${url}`).toBeDefined()
  return JSON.parse(String(call?.[1]?.body))
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => ok())
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('PersonalTopicActions', () => {
  test('the no-topic group has nothing to rename, ungroup or remove', () => {
    render(<PersonalTopicActions topic={null} count={2} onChanged={vi.fn()} />)

    expect(screen.queryByTestId('personal-topic-actions')).not.toBeInTheDocument()
  })

  test('renaming a topic sends the new name to the topic route and reads the list again', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    const input = screen.getByLabelText('Topic name')
    expect(input).toHaveValue('Brandschutz')
    await userEvent.clear(input)
    await userEvent.type(input, 'Brand  und Rauch')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory/topics', expect.objectContaining({ method: 'PATCH' }))
    expect(sentTo('/api/user/memory/topics', 'PATCH')).toEqual({ from: 'Brandschutz', to: 'Brand und Rauch' })
  })

  test('a name over the topic bound is refused on the screen and sends nothing', async () => {
    render(<PersonalTopicActions topic="Brandschutz" count={3} onChanged={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    await userEvent.clear(screen.getByLabelText('Topic name'))
    await userEvent.type(screen.getByLabelText('Topic name'), 'x'.repeat(41))

    expect(screen.getByText('At most 40 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('the same topic in another case is no change and sends nothing', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    await userEvent.clear(screen.getByLabelText('Topic name'))
    await userEvent.type(screen.getByLabelText('Topic name'), 'brandschutz')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('ungrouping sends no topic for the notes, which keep their text', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo('/api/user/memory/topics', 'PATCH')).toEqual({ from: 'Brandschutz', to: null })
  })

  test('removing a topic says how many notes go before it deletes them', async () => {
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Remove topic and all its notes' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('3 notes in "Brandschutz" are removed for good.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove topic and all its notes' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo('/api/user/memory/topics', 'DELETE')).toEqual({ name: 'Brandschutz' })
  })

  test('a refused write says so, changes nothing on the screen and reads nothing again', async () => {
    fetchMock.mockImplementation(() => new Response('nope', { status: 500 }))
    const onChanged = vi.fn()
    render(<PersonalTopicActions topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The note was not saved. Try again.'))
    expect(onChanged).not.toHaveBeenCalled()
  })
})

describe('PersonalNoteTopicMove', () => {
  test('moving a note PATCHes its own item with the topic the person picked', async () => {
    const onChanged = vi.fn()
    render(<PersonalNoteTopicMove item={{ id: 'n-1', topic: null }} topics={['Brandschutz']} onChanged={onChanged} />)

    await userEvent.type(screen.getByRole('combobox', { name: 'Move to …' }), 'brand')
    await userEvent.click(screen.getByRole('option', { name: 'Brandschutz' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory/n-1', expect.objectContaining({ method: 'PATCH' }))
    expect(sentTo('/api/user/memory/n-1', 'PATCH')).toEqual({ topic: 'Brandschutz' })
  })
})
