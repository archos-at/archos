import { fireEvent, render, screen } from '@/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ComposerExcerptBar } from './ComposerExcerptBar'

const EXCERPT = { conversationId: 'c1', messageId: 'a1', text: 'Die Fluchtweglänge darf 40 m nicht überschreiten.' }

describe('the selected part of an answer above the composer', () => {
  it('shows the part and takes it away again on request', () => {
    const onClear = vi.fn()
    render(<ComposerExcerptBar excerpt={EXCERPT} onClear={onClear} />)

    expect(screen.getByTestId('composer-answer-excerpt')).toHaveTextContent(EXCERPT.text)
    fireEvent.click(screen.getByRole('button'))

    expect(onClear).toHaveBeenCalledOnce()
  })

  it('shows nothing while no part is selected', () => {
    render(<ComposerExcerptBar excerpt={null} onClear={() => undefined} />)

    expect(screen.queryByTestId('composer-answer-excerpt')).not.toBeInTheDocument()
  })
})
