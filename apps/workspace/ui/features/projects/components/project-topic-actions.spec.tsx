/**
 * The topic actions of the project memory shelf: rename or merge a topic, ungroup
 * it, and move one note. The calls are the shelf's own PATCH routes; the topic
 * picker is stubbed here, its behaviour is its own spec's.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test-utils'
import { ProjectNoteTopicMove, ProjectTopicActions } from './project-topic-actions'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

vi.mock('@/components/memory/topic-picker', async () => {
  const { createElement } = await import('react')
  return {
    TopicPicker: ({ onChange, disabled }: { onChange: (topic: string | null) => void; disabled?: boolean }) =>
      createElement(
        'button',
        { type: 'button', disabled, onClick: () => onChange('Stellplätze') },
        'pick Stellplätze'
      ),
  }
})

const PROJECT = 'p-1'
const TOPICS_URL = `/api/projects/${PROJECT}/memory/topics`

/** The JSON body of the Nth fetch call. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

describe('ProjectTopicActions', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    toast.error.mockClear()
    fetchMock = vi.fn(async () => Response.json({ moved: 3 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('the group of notes with no topic has no topic actions', () => {
    const { container } = render(
      <ProjectTopicActions projectId={PROJECT} topic={null} count={2} onChanged={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('ungroup PATCHes the topic with a null target and reports the change', async () => {
    const onChanged = vi.fn()
    render(<ProjectTopicActions projectId={PROJECT} topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(TOPICS_URL, expect.objectContaining({ method: 'PATCH' }))
    expect(bodyOf(fetchMock, 0)).toEqual({ from: 'Brandschutz', to: null })
  })

  test('rename sends the normalized new name, and merges when it is another topic', async () => {
    const onChanged = vi.fn()
    render(<ProjectTopicActions projectId={PROJECT} topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, '  Brandschutz  Konzept ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(bodyOf(fetchMock, 0)).toEqual({ from: 'Brandschutz', to: 'Brandschutz Konzept' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('save stays disabled for an unchanged name and for a name over the bound', async () => {
    render(<ProjectTopicActions projectId={PROJECT} topic="Brandschutz" count={3} onChanged={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Rename topic' }))
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, 'x'.repeat(40))
    expect(save).toBeEnabled()
    expect(screen.queryByText('At most 40 characters.')).not.toBeInTheDocument()

    await userEvent.type(input, 'x')
    expect(screen.getByText('At most 40 characters.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a refused change reports the failure and does not reload the groups', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 500 }))
    const onChanged = vi.fn()
    render(<ProjectTopicActions projectId={PROJECT} topic="Brandschutz" count={3} onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(onChanged).not.toHaveBeenCalled()
  })
})

describe('ProjectNoteTopicMove', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => Response.json({ item: { id: 'm-1' } }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('moving a note PATCHes the note with its new topic', async () => {
    const onChanged = vi.fn()
    render(
      <ProjectNoteTopicMove
        projectId={PROJECT}
        item={{ id: 'm-1', topic: 'Brandschutz' }}
        topics={['Brandschutz', 'Stellplätze']}
        onChanged={onChanged}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'pick Stellplätze' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT}/memory/m-1`,
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(bodyOf(fetchMock, 0)).toEqual({ topic: 'Stellplätze' })
  })

  test('choosing the topic the note already has sends nothing', async () => {
    render(
      <ProjectNoteTopicMove
        projectId={PROJECT}
        item={{ id: 'm-1', topic: 'Stellplätze' }}
        topics={['Stellplätze']}
        onChanged={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'pick Stellplätze' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
