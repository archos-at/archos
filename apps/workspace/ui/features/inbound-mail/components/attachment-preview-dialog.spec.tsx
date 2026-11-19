import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files/mail',
  useSearchParams: () => new URLSearchParams(),
}))
// pdf.js does not draw in jsdom; the viewer is the app's own and has its own specs. Here: which bytes it is given.
vi.mock('@/features/knowledge/components/pdf-document-view', () => ({
  PdfDocumentView: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="pdf-document-view" data-src={src}>
      {title}
    </div>
  ),
}))

import { render, screen, waitFor, within } from '@/test-utils'
import { DETAIL_VARIANTS, FIXTURE_NOW, FOLDERS, PROJECT_ID, fixtureClient } from '@/app/dev/inbound-mail/fixtures'
import { InboundMailDetail } from './inbound-mail-detail'

function renderWithBytes(name: string) {
  const fixture = DETAIL_VARIANTS[name]
  const client = { ...fixtureClient({ detail: fixture }), partContentUrl: (_project: string, _mail: string, partId: string) => `/held/${partId}` }
  render(
    <InboundMailDetail
      projectId={PROJECT_ID}
      mailId={fixture.view.id}
      initial={fixture.view}
      initialText={fixture.text}
      folders={FOLDERS}
      client={client}
      onChanged={vi.fn()}
      now={FIXTURE_NOW}
      pollMs={1}
    />
  )
  return fixture
}

describe('the attachment preview', () => {
  it('offers „Preview“ in words on each clean PDF or picture, and none on a file it cannot show', () => {
    const fixture = renderWithBytes('mixed-attachments')
    const dwg = fixture.view.parts.find((part) => part.filename === 'Grundriss_EG.dwg')
    expect(within(screen.getByTestId(`attachment-${dwg?.id}`)).queryByTestId('attachment-preview-open')).toBeNull()
    const previews = screen.getAllByTestId('attachment-preview-open')
    expect(previews.length).toBeGreaterThanOrEqual(2)
    expect(previews[0]).toHaveTextContent('Preview')
  })

  it('opens a PDF in the app’s viewer with its pages, steps to the next attachment, and gives the focus back', async () => {
    renderWithBytes('mixed-attachments')
    const open = screen.getAllByTestId('attachment-preview-open')[0]
    await userEvent.click(open)
    const dialog = await screen.findByTestId('attachment-preview')
    const viewer = within(dialog).getByTestId('pdf-document-view')
    expect(viewer.getAttribute('data-src')).toMatch(/^\/held\//)
    expect(dialog).toHaveTextContent(/Attachment 1 of \d/)
    const first = dialog.getAttribute('data-preview-id')
    await userEvent.click(within(dialog).getByTestId('attachment-preview-next'))
    expect(screen.getByTestId('attachment-preview').getAttribute('data-preview-id')).not.toBe(first)
    expect(screen.getByTestId('attachment-preview')).toHaveTextContent(/Attachment 2 of \d/)
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('attachment-preview').getAttribute('data-preview-id')).toBe(first)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('attachment-preview')).toBeNull())
    expect(open).toHaveFocus()
  })
})
