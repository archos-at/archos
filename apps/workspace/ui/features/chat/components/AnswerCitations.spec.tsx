import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect } from 'vitest'
import { AnswerCitations } from './AnswerCitations'
import { buildCitationModel, encodeCitationLink } from '../lib/citations'
import type { CitationSource } from '../types'

const at = new Date('2026-07-28T12:00:00Z')
const OIB = 'oib-rl_2.1_ausgabe_mai_2023.pdf'

const locus = (page: number, number: number): CitationSource => ({
  id: `c${number}`,
  content: `[KB] ${OIB}, p.${page}`,
  citationKey: `${OIB}, p.${page}`,
  fileName: OIB,
  collection: 'oib_knowledge',
  title: 'OIB-Richtlinie 2.1, Ausgabe Mai 2023',
  origin: 'kb',
  kind: 'building_law',
  lane: 'building_law_oib',
  page,
  number,
  isCited: true,
  timestamp: at,
})

const answered = () => buildCitationModel({ citations: [locus(5, 1), locus(18, 2)] })
const first = answered()
const second = answered()
const link = encodeCitationLink({ document: first[0]!, locus: first[0]!.loci[1]! })

vi.mock('./source-preview/source-document-dialog', () => ({
  SourceDocumentDialog: ({
    citation,
    onClose,
  }: {
    citation: { document: { id: string } }
    onClose: () => void
  }) => (
    <div data-testid="document-dialog">
      {citation.document.id}
      <button type="button" onClick={onClose}>
        schließen
      </button>
    </div>
  ),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`cite=${link}`),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/chat',
}))

describe('an answer arriving on a shared citation link', () => {
  test('one link opens one dialog, however many answers hold the document', () => {
    render(
      <>
        <AnswerCitations documents={first} anchorPrefix="src-m1-">
          <p>Erste Antwort</p>
        </AnswerCitations>
        <AnswerCitations documents={second} anchorPrefix="src-m2-">
          <p>Zweite Antwort</p>
        </AnswerCitations>
      </>
    )

    const dialogs = screen.getAllByTestId('document-dialog')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]).toHaveTextContent(first[0]!.id)
  })

  test('closing the dialog does not hand the link to the next answer', async () => {
    render(
      <>
        <AnswerCitations documents={first} anchorPrefix="src-m1-">
          <p>Erste Antwort</p>
        </AnswerCitations>
        <AnswerCitations documents={second} anchorPrefix="src-m2-">
          <p>Zweite Antwort</p>
        </AnswerCitations>
      </>
    )

    await userEvent.click(screen.getByRole('button', { name: 'schließen' }))

    expect(screen.queryByTestId('document-dialog')).toBeNull()
  })

  test('an answer that does not hold the linked document opens nothing', () => {
    const other = buildCitationModel({
      citations: [{ ...locus(1, 1), fileName: 'Andere.pdf', citationKey: 'Andere.pdf, p.1' }],
    })

    render(
      <AnswerCitations documents={other} anchorPrefix="src-m3-">
        <p>Antwort ohne dieses Dokument</p>
      </AnswerCitations>
    )

    expect(screen.queryByTestId('document-dialog')).toBeNull()
  })
})

describe('a link the answer wrote to a file it made', () => {
  test('downloads the conversation’s draft instead of opening a page that does not exist', async () => {
    const { MarkdownRenderer } = await import('@/shared/components/MarkdownRenderer')
    const { useChatStore } = await import('../store')
    useChatStore.setState({ currentConversation: { id: 's_1' } as never })
    render(
      <AnswerCitations documents={[]} anchorPrefix="src-d-">
        <MarkdownRenderer content="Hier ist die Datei: [Regenbogen.pdf](/drafts/Regenbogen.pdf)" />
      </AnswerCitations>,
    )
    const link = screen.getByRole('link', { name: 'Regenbogen.pdf' })
    expect(link).toHaveAttribute('href', '/api/conversations/s_1/draft/download?path=%2Fdrafts%2FRegenbogen.pdf')
    expect(link).toHaveAttribute('download')
    expect(link).toHaveAttribute('data-testid', 'draft-file-reference')
    expect(link.querySelector('svg')).not.toBeNull()
  })
})
