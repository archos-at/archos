import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import { TaskCreatedCard } from './TaskCreatedCard'

const TASK = {
  taskId: '00000000-0000-4000-8000-0000000000f1',
  kind: 'submission_check' as const,
  title: 'Einreichcheck: Bauansuchen Haus A',
  goal: 'Mach den Einreichcheck für das Bauansuchen bis Freitag',
  dueAt: '2026-09-18T23:59:59.999Z',
  conversationId: 's_00000000_0000_4000_8000_0000000000f2',
}

describe('TaskCreatedCard — what it reports', () => {
  it('names the kind, the goal and the deadline — the receipt and nothing else', () => {
    render(<TaskCreatedCard {...TASK} />)

    expect(screen.getByText(TASK.title)).toBeInTheDocument()
    expect(screen.getByText(TASK.goal)).toBeInTheDocument()
    expect(screen.getByTestId('task-created-kind')).toHaveTextContent('Submission check')
    expect(screen.getByTestId('task-created-due')).toHaveTextContent('by Sep 18, 2026')
  })

  it('states no status of its own', () => {
    render(<TaskCreatedCard {...TASK} />)
    expect(screen.queryByTestId('task-created-status')).not.toBeInTheDocument()
  })

  it('says nothing about a deadline nobody named', () => {
    render(<TaskCreatedCard {...TASK} dueAt={null} />)
    expect(screen.queryByTestId('task-created-due')).not.toBeInTheDocument()
  })

  it('renders no date rather than „Invalid Date" for a date it cannot read', () => {
    render(<TaskCreatedCard {...TASK} dueAt="not-a-date" />)
    expect(screen.queryByTestId('task-created-due')).not.toBeInTheDocument()
  })
})

describe('TaskCreatedCard — no link to a run that lives right here', () => {
  it('offers no conversation link: the run block follows the card in this thread', () => {
    render(<TaskCreatedCard {...TASK} />)
    expect(screen.queryByTestId('task-created-open')).not.toBeInTheDocument()
    render(<TaskCreatedCard {...TASK} conversationId={null} />)
    expect(screen.queryByTestId('task-created-open')).not.toBeInTheDocument()
  })
})
