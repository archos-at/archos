import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'
import { AnswerCardItem } from './AnswerCards'
import { CARD_PREVIEW_FIXTURES } from '../preview-fixtures'

const CARD = CARD_PREVIEW_FIXTURES.calculation!

describe('AnswerCardItem', () => {
  it('gives two answers without a message id different surface ids', async () => {
    render(
      <>
        <AnswerCardItem card={CARD} index={0} />
        <AnswerCardItem card={CARD} index={0} />
      </>
    )
    await waitFor(() => expect(document.querySelectorAll('[data-a2ui-surface]')).toHaveLength(2))
    const ids = [...document.querySelectorAll('[data-a2ui-surface]')].map((node) => node.getAttribute('data-a2ui-surface'))
    expect(new Set(ids).size).toBe(2)
  })

  it('keys the surface by the message when there is one', async () => {
    render(<AnswerCardItem card={CARD} index={3} messageId="m7" />)
    await waitFor(() => expect(document.querySelector('[data-a2ui-surface="m7:3"]')).not.toBeNull())
  })

  it('draws a file a script made as a file card, and a Markdown draft as the draft card', async () => {
    const draft = {
      type: 'document_draft' as const,
      title: 'T',
      bytes: 10,
      version: 1,
      media_type: null,
      document_id: null,
      version_id: null,
      version_state: null,
    }
    render(
      <>
        <AnswerCardItem
          card={{ ...draft, path: '/drafts/a.docx', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }}
          index={0}
        />
        <AnswerCardItem card={{ ...draft, path: '/drafts/b.md' }} index={1} />
      </>
    )
    expect(await screen.findByTestId('file-draft-card')).toHaveAttribute('data-format', 'word')
    expect(await screen.findByTestId('document-draft-card')).toBeInTheDocument()
  })
})
