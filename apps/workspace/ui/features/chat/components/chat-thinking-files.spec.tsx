import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useLayoutStore } from '@/features/layout/store'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { storedSteps } from '@/test-utils/wire-v2-steps'
import { ChatThinking } from './ChatThinking'

vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }))

const fileTurn = (): StoredThinkingStep[] =>
  storedSteps([
    { id: 'tool:1', kind: 'tool', tool: 'execute', status: 'ok' },
    {
      id: 'status:file-run:a',
      kind: 'status',
      slot: 'file-run:a',
      key: 'status.action.fileMake',
      values: { file: 'Raumbuch.xlsx', format: 'xlsx' },
      detail: { writes: ['Raumbuch.xlsx'], attempt: 1, status: 'error' },
    },
    {
      id: 'status:file-run:b',
      kind: 'status',
      slot: 'file-run:b',
      key: 'status.action.fileRetry',
      values: { file: 'Raumbuch.xlsx', format: 'xlsx' },
      detail: { writes: ['Raumbuch.xlsx'], attempt: 2, status: 'ok', made: ['Raumbuch.xlsx'] },
    },
  ])

describe('ChatThinking with files the agent made', () => {
  beforeEach(() => useLayoutStore.setState({ showTechnicalReasoning: false }))

  test('a turn that only made a file is not „answered without research“', () => {
    render(<ChatThinking steps={fileTurn()} isThinking={false} />)
    expect(screen.queryByTestId('derivation-no-research')).toBeNull()
    expect(screen.getByRole('button', { name: /Trace/ })).toHaveTextContent(/Trace\s·\s1\sfile made/)
  })

  test('opened, the file is one row, and the failed first try is nowhere', async () => {
    render(<ChatThinking steps={fileTurn()} isThinking={false} userQuestion="Raumbuch als Excel" defaultOpen />)
    expect(screen.queryByText(/Raumbuch als Excel/)).toBeNull()
    const rows = within(screen.getByTestId('file-work')).getAllByTestId('file-work-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Raumbuch.xlsx made')
    expect(rows[0]).toHaveAttribute('data-outcome', 'made')
    expect(screen.getByTestId('file-work').textContent).not.toMatch(/error|failed|execute|code/i)
    await userEvent.click(screen.getByTestId('file-work-toggle'))
    expect(screen.getAllByTestId('file-work-phase').map((phase) => phase.dataset.kind)).toEqual(['make', 'ready'])
  })

  test('a file that could not be made puts a warning on the header', () => {
    const failed = storedSteps([
      {
        id: 'status:file-run:a',
        kind: 'status',
        slot: 'file-run:a',
        key: 'status.action.fileMake',
        values: { file: 'Raumbuch.xlsx', format: 'xlsx' },
        detail: { writes: ['Raumbuch.xlsx'], attempt: 1, status: 'timeout' },
      },
    ])
    render(<ChatThinking steps={failed} isThinking={false} />)
    expect(screen.getByTestId('derivation-warning')).toHaveTextContent(/1\sfile not finished/)
  })

  test('while it runs, the header line is the file, not the tool', () => {
    const live = storedSteps([
      {
        id: 'status:file-run:a',
        kind: 'status',
        slot: 'file-run:a',
        key: 'status.action.fileMake',
        values: { file: 'Raumbuch.xlsx', format: 'xlsx' },
        detail: { writes: ['Raumbuch.xlsx'], attempt: 1 },
      },
    ])
    render(<ChatThinking steps={live} isThinking />)
    expect(screen.getByRole('button')).toHaveTextContent('Making the Excel workbook: Raumbuch.xlsx …')
  })
})
