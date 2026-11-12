/**
 * The shelf as folders by topic (ADR-0180, topics amendment). What must hold:
 * one folder per topic in the summary's order, the notes without a topic in
 * their own folder last, each folder's count is the summary's, and a folder's
 * actions are the caller's, with none for the notes without a topic.
 */
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { TopicFolders } from './topic-folders'

interface Row {
  id: string
  topic: string | null
  content: string
}

const row = (id: string, topic: string | null): Row => ({ id, topic, content: `Notiz ${id}` })

const ITEMS: Row[] = [row('a', 'Brandschutz'), row('b', null), row('c', 'Stellplätze'), row('d', 'Brandschutz')]
const TOPICS = [
  { name: 'Brandschutz', count: 2 },
  { name: 'Stellplätze', count: 1 },
]

const folders = (): string[] => screen.getAllByTestId('topic-folder').map((folder) => folder.textContent ?? '')

describe('TopicFolders', () => {
  test('one folder per topic in the summary order, the notes without a topic last', () => {
    render(<TopicFolders items={ITEMS} topics={TOPICS} renderItem={(item) => <p>{item.content}</p>} />)

    const [first, second, third] = screen.getAllByTestId('topic-folder')
    expect(first).toHaveTextContent('Brandschutz')
    expect(first).toHaveTextContent('2 notes')
    expect(second).toHaveTextContent('Stellplätze')
    expect(second).toHaveTextContent('1 note')
    expect(third).toHaveTextContent('No topic')
    expect(folders()).toHaveLength(3)
  })

  test('a folder holds the notes of its topic, in the order they were given', () => {
    render(<TopicFolders items={ITEMS} topics={TOPICS} renderItem={(item) => <p>{item.content}</p>} />)

    const [fireSafety] = screen.getAllByTestId('topic-folder')
    const names = within(fireSafety)
      .getAllByText(/^Notiz /)
      .map((node) => node.textContent)
    expect(names).toEqual(['Notiz a', 'Notiz d'])
  })

  test('no folder for a topic that holds no note on this shelf', () => {
    render(
      <TopicFolders
        items={[row('a', 'Brandschutz')]}
        topics={[...TOPICS]}
        renderItem={(item) => <p>{item.content}</p>}
      />
    )

    expect(screen.getAllByTestId('topic-folder')).toHaveLength(1)
    expect(screen.queryByText('Stellplätze')).not.toBeInTheDocument()
  })

  test('a folder can be closed and opened from its heading', async () => {
    render(<TopicFolders items={ITEMS} topics={TOPICS} renderItem={(item) => <p>{item.content}</p>} />)

    const trigger = screen.getByRole('button', { name: /Brandschutz/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('the caller renders the actions of each topic, and of no topic as null', () => {
    const renderTopicActions = vi.fn((topic: string | null) => <button type="button">Aktion {topic ?? 'keins'}</button>)
    render(
      <TopicFolders
        items={ITEMS}
        topics={TOPICS}
        renderItem={(item) => <p>{item.content}</p>}
        renderTopicActions={renderTopicActions}
      />
    )

    expect(screen.getByRole('button', { name: 'Aktion Brandschutz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aktion Stellplätze' })).toBeInTheDocument()
    expect(renderTopicActions).toHaveBeenCalledWith(null)
  })

  test('no topic folder when every note has a topic', () => {
    render(
      <TopicFolders
        items={[row('a', 'Brandschutz')]}
        topics={[{ name: 'Brandschutz', count: 1 }]}
        renderItem={(item) => <p>{item.content}</p>}
      />
    )

    expect(folders()).toEqual([expect.stringContaining('Brandschutz')])
  })
})
