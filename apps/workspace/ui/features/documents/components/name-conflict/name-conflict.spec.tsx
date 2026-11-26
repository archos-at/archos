import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import type { ConflictChoice, ConflictRow } from '../../lib/name-conflict'
import type { AskedQuestion, ConflictAnswer } from '../../hooks/use-name-conflict-prompt'
import { CopyPathsButton } from './copy-paths-button'
import { NameConflictDialog } from './name-conflict-dialog'
import { NameConflictList } from './name-conflict-list'

const row = (path: string, overrides: Partial<ConflictRow> = {}): ConflictRow => {
  const name = path.split('/').pop()!
  return {
    key: path,
    path,
    name,
    existingName: name,
    within: 'folder',
    choice: 'replace',
    keepBothAs: name.replace('.pdf', ' 2.pdf'),
    ...overrides,
  }
}

function Choosing({ rows }: { rows: ConflictRow[] }) {
  const [choices, setChoices] = useState(new Map<string, ConflictChoice>())
  return (
    <NameConflictList
      rows={rows.map((each) => ({ ...each, choice: choices.get(each.key) ?? each.choice }))}
      operation="upload"
      onChoose={(keys, choice) => setChoices((previous) => new Map([...previous, ...keys.map((key) => [key, choice] as const)]))}
    />
  )
}

const checked = (testId: string) => screen.getAllByTestId(testId).map((item) => item.getAttribute('aria-checked'))

describe('NameConflictList', () => {
  const rows = [row('Pläne/A.pdf'), row('Pläne/B.pdf'), row('Pläne/C.pdf', { within: 'drop', choice: 'keep_both' })]

  it('answers one row at a time, and says what each answer does', async () => {
    render(<Choosing rows={rows} />)

    await userEvent.click(screen.getAllByTestId('name-conflict-keep_both')[0])

    expect(checked('name-conflict-keep_both')).toEqual(['true', 'false', 'true'])
    expect(screen.getAllByTestId('name-conflict-outcome')[0]).toHaveTextContent('Comes in as “A 2.pdf”.')
    expect(screen.getAllByTestId('name-conflict-outcome')[1]).toHaveTextContent('Becomes a new revision of “B.pdf”')
  })

  it('applies one answer to every row that can take it once „Apply to all" is ticked', async () => {
    render(<Choosing rows={rows} />)

    await userEvent.click(screen.getByTestId('name-conflict-apply-all'))
    await userEvent.click(screen.getAllByTestId('name-conflict-skip')[1])

    expect(checked('name-conflict-skip')).toEqual(['true', 'true', 'true'])
    await userEvent.click(screen.getAllByTestId('name-conflict-replace')[0])
    expect(checked('name-conflict-replace')).toEqual(['true', 'true'])
    expect(checked('name-conflict-skip')).toEqual(['false', 'false', 'true'])
  })

  it('offers no replacement for a file that only clashes with another file of the same drop', () => {
    render(<Choosing rows={rows} />)
    const lastRow = screen.getAllByTestId('name-conflict-row')[2]
    expect(within(lastRow).queryByTestId('name-conflict-replace')).toBeNull()
  })

  it('offers only the answers the server lists, and never applies a replacement to a row that cannot take one', async () => {
    render(<Choosing rows={[row('Pläne/A.pdf'), row('Ablage/B.pdf', { choice: 'keep_both', choices: ['keep_both', 'skip'] })]} />)
    const [, withoutReplace] = screen.getAllByTestId('name-conflict-row')
    expect(within(withoutReplace).queryByTestId('name-conflict-replace')).toBeNull()

    await userEvent.click(screen.getByTestId('name-conflict-apply-all'))
    await userEvent.click(screen.getAllByTestId('name-conflict-skip')[0])
    await userEvent.click(screen.getAllByTestId('name-conflict-replace')[0])

    expect(checked('name-conflict-replace')).toEqual(['true'])
    expect(checked('name-conflict-skip')).toEqual(['false', 'true'])
  })

  it('selects with the arrow keys, as a radio group does', async () => {
    render(<Choosing rows={[row('Pläne/A.pdf')]} />)

    screen.getByTestId('name-conflict-replace').focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(checked('name-conflict-keep_both')).toEqual(['true'])
  })

  it('shows every row whole, with no count of the rest', () => {
    const many = Array.from({ length: 80 }, (_, i) => row(`Ein/sehr/langer/Pfad/Plan_${i}.pdf`))
    render(<NameConflictList rows={many} operation="move" />)

    expect(screen.getAllByTestId('name-conflict-row')).toHaveLength(80)
    expect(screen.getByTestId('name-conflict-list').querySelector('.truncate, [class*="line-clamp"]')).toBeNull()
    expect(screen.getAllByTestId('name-conflict-replace')[0]).toBeDisabled()
  })
})

describe('CopyPathsButton', () => {
  it('copies every path, one per line, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CopyPathsButton paths={['A/Plan.pdf', 'B/Plan.pdf']} testId="copy" />)

    await userEvent.click(screen.getByTestId('copy'))

    expect(writeText).toHaveBeenCalledWith('A/Plan.pdf\nB/Plan.pdf')
    expect(await screen.findByRole('status')).toHaveTextContent('Copied')
  })

  it('says when the clipboard refused, rather than nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
      configurable: true,
    })
    render(<CopyPathsButton paths={['A/Plan.pdf']} testId="copy" />)

    await userEvent.click(screen.getByTestId('copy'))

    expect(await screen.findByRole('status')).toHaveTextContent('Not copied')
    expect(screen.getByTestId('copy')).toHaveAttribute('data-state', 'failed')
  })

  it('says so too where there is no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    render(<CopyPathsButton paths={['A/Plan.pdf']} testId="copy" />)

    await userEvent.click(screen.getByTestId('copy'))

    expect(screen.getByTestId('copy')).toHaveAttribute('data-state', 'failed')
  })
})

describe('NameConflictDialog', () => {
  function Asking({ questions, onAnswer }: { questions: AskedQuestion[]; onAnswer: (answer: ConflictAnswer | null) => void }) {
    const [index, setIndex] = useState(0)
    return (
      <NameConflictDialog
        prompt={{
          question: questions[index] ?? null,
          resolve: (answer) => {
            onAnswer(answer)
            setIndex((current) => current + 1)
          },
        }}
      />
    )
  }

  const question = (id: number, rows: ConflictRow[]): AskedQuestion => ({ id, operation: 'upload', folderName: '', rows })

  it('answers with every row’s choice, and nothing when cancelled', async () => {
    const onAnswer = vi.fn()
    render(
      <Asking
        questions={[question(1, [row('A/Plan.pdf'), row('A/Schnitt.pdf')]), question(2, [row('B/Plan.pdf')])]}
        onAnswer={onAnswer}
      />
    )

    await userEvent.click(screen.getAllByTestId('name-conflict-skip')[1])
    expect(screen.getByTestId('name-conflict-confirm')).toHaveTextContent('Upload 1 file')
    await userEvent.click(screen.getByTestId('name-conflict-confirm'))
    expect(onAnswer).toHaveBeenLastCalledWith(
      new Map([
        ['A/Plan.pdf', 'replace'],
        ['A/Schnitt.pdf', 'skip'],
      ])
    )

    await screen.findByText('B/Plan.pdf')
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(onAnswer).toHaveBeenLastCalledWith(null)
  })

  it('starts the next question fresh: its own defaults, „Apply to all" unticked', async () => {
    render(
      <Asking
        questions={[question(1, [row('A/Plan.pdf'), row('A/Schnitt.pdf')]), question(2, [row('A/Plan.pdf'), row('A/Schnitt.pdf')])]}
        onAnswer={vi.fn()}
      />
    )

    await userEvent.click(screen.getByTestId('name-conflict-apply-all'))
    await userEvent.click(screen.getAllByTestId('name-conflict-skip')[0])
    await userEvent.click(screen.getByTestId('name-conflict-confirm'))

    expect(screen.getByTestId('name-conflict-apply-all')).not.toBeChecked()
    expect(checked('name-conflict-replace')).toEqual(['true', 'true'])
  })
})
