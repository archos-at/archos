import { act, fireEvent, render, screen } from '@/test-utils'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EXCERPT_SOURCE_ATTRIBUTE } from '../lib/answer-excerpt'
import { useChatStore } from '../store'
import { AnswerExcerptAsk } from './AnswerExcerptAsk'

const Thread = () => (
  <>
    <p data-testid="question">Wie lang darf der Fluchtweg sein?</p>
    <div {...{ [EXCERPT_SOURCE_ATTRIBUTE]: 'a1' }}>
      <p data-testid="answer">Die Fluchtweglänge darf 40 m nicht überschreiten.</p>
    </div>
    <AnswerExcerptAsk conversationId="c1" />
  </>
)

const select = async (testId: string) => {
  const node = screen.getByTestId(testId).firstChild!
  const range = document.createRange()
  range.selectNodeContents(node)
  await act(async () => {
    fireEvent.pointerDown(node.parentElement!)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    fireEvent.pointerUp(node.parentElement!)
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(100, 200, 300, 20)
})

beforeEach(() => {
  document.getSelection()!.removeAllRanges()
  useChatStore.setState({ composerExcerpt: null })
})

describe('asking about a part of an answer', () => {
  it('offers the question once text in an answer is selected, and puts that part in the composer', async () => {
    render(<Thread />)
    expect(screen.queryByTestId('answer-excerpt-ask')).not.toBeInTheDocument()

    await select('answer')
    fireEvent.click(screen.getByRole('button'))

    expect(useChatStore.getState().composerExcerpt).toEqual({
      conversationId: 'c1',
      messageId: 'a1',
      text: 'Die Fluchtweglänge darf 40 m nicht überschreiten.',
    })
    expect(screen.queryByTestId('answer-excerpt-ask')).not.toBeInTheDocument()
    expect(document.getSelection()!.isCollapsed).toBe(true)
  })

  it('offers nothing for a selection outside an answer', async () => {
    render(<Thread />)

    await select('question')

    expect(screen.queryByTestId('answer-excerpt-ask')).not.toBeInTheDocument()
  })
})
