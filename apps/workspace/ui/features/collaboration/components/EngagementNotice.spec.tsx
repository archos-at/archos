import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'

import { EngagementNotice } from './EngagementNotice'
import { PRODUCT_NAME } from '@/lib/brand'

describe('EngagementNotice', () => {
  test('renders nothing in ask mode with nothing to offer — the composer already says it (NF-8)', () => {
    const { container } = render(<EngagementNotice mode="ask" onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('offers mention in ask mode, phrased as a question and not as a change', () => {
    render(<EngagementNotice mode="ask" suggestion="mention" onChange={vi.fn()} />)

    const notice = screen.getByTestId('engagement-notice')
    expect(notice).toHaveTextContent(
      `Several of you are talking here. Should ${PRODUCT_NAME} wait to be mentioned?`,
    )
    expect(notice).not.toHaveTextContent(`${PRODUCT_NAME} answers when mentioned`)
  })

  test('accepting the offer sets mention', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockResolvedValue(true)
    render(<EngagementNotice mode="ask" suggestion="mention" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Answer only when mentioned' }))

    expect(onChange).toHaveBeenCalledWith('mention')
  })

  test('an offer nobody may accept is not shown at all', () => {
    const { container } = render(
      <EngagementNotice mode="ask" suggestion="mention" onChange={vi.fn()} canChange={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('states the rule in mention mode', () => {
    render(<EngagementNotice mode="mention" onChange={vi.fn()} />)

    expect(screen.getByTestId('engagement-notice')).toHaveTextContent(
      `${PRODUCT_NAME} answers when mentioned`,
    )
    expect(screen.getByTestId('engagement-notice')).toHaveTextContent(
      'Several of you are talking here, so a plain message goes to everyone in the chat.',
    )
  })

  test('is the control as well as the explanation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockResolvedValue(true)
    render(<EngagementNotice mode="mention" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: `Let ${PRODUCT_NAME} answer everything` }))

    expect(onChange).toHaveBeenCalledWith('ask')
  })

  test('a refused change says so — a control that silently does nothing reads as broken', async () => {
    const user = userEvent.setup()
    render(<EngagementNotice mode="mention" onChange={vi.fn().mockResolvedValue(false)} />)

    await user.click(screen.getByRole('button', { name: `Let ${PRODUCT_NAME} answer everything` }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That could not be changed.')
  })

  test('a thrown change is reported too, not swallowed', async () => {
    const user = userEvent.setup()
    render(
      <EngagementNotice
        mode="mention"
        onChange={vi.fn().mockRejectedValue(new Error('offline'))}
      />,
    )

    await user.click(screen.getByRole('button', { name: `Let ${PRODUCT_NAME} answer everything` }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('a reader who cannot write here still gets the explanation, without the control', () => {
    render(<EngagementNotice mode="mention" onChange={vi.fn()} canChange={false} />)

    expect(screen.getByTestId('engagement-notice')).toHaveTextContent(
      `${PRODUCT_NAME} answers when mentioned`,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
