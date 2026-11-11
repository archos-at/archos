import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AttachedTextView } from '@/lib/base-knowledge/platform/text-wire'
import { ManifestationText } from './manifestation-text'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

/**
 * The text of an edition on its change request (ADR-0165, "Texts are attached
 * in the request"), as the law map's edition shows it: the reviewer opens it
 * beside the edition, and in a draft whoever may write platform knowledge
 * attaches it there, by upload or by URL.
 */

const ID = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const BASE = `/api/platform/knowledge/change-requests/${ID}`
const RECORD = 'manifestation:xa-guide-1-2020-text'

const TEXT: AttachedTextView = {
  revisionId: 'r1',
  recordId: RECORD,
  editionId: 'edition:xa-guide-1-2020',
  corpusFile: 'xa-guide-1-2020.pdf',
  origin: 'url',
  sha256: 'c'.repeat(64),
  bytes: 1_400_000,
  pages: 12,
  sourceId: 'xa-guides',
  sourceOrigin: 'released',
  countsAsFetched: true,
  url: 'https://guides.example.org/files/guide-1-2020.pdf',
  attachedBy: 'u',
  attachedAt: '2026-11-11T09:00:00Z',
}

const fetchMock = vi.fn()

const show = (text: AttachedTextView | undefined, canAttach: boolean, onAttached = vi.fn()) => {
  render(<ManifestationText requestId={ID} countryId="XA" recordId={RECORD} text={text} canAttach={canAttach} onAttached={onAttached} />)
  return onAttached
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ text: TEXT, status: 'written', stored: true }, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('an edition’s text on its change request', () => {
  test('the reviewer opens the text and sees where it came from, with nothing to attach', () => {
    show(TEXT, false)

    const text = screen.getByTestId('manifestation-text')
    expect(within(text).getByRole('link', { name: /xa-guide-1-2020\.pdf/ })).toHaveAttribute('href', `${BASE}/texts/xa-guide-1-2020-text`)
    expect(within(text).getByRole('link', { name: 'fetched from guides.example.org' })).toHaveAttribute('href', TEXT.url)
    expect(within(text).getByText('12 pages')).toBeInTheDocument()
    expect(within(text).queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument()
  })

  test('in a draft, an upload goes to the request with the manifestation’s key, and the request is read again', async () => {
    const user = userEvent.setup()
    const onAttached = show(undefined, true)

    const text = screen.getByTestId('manifestation-text')
    expect(within(text).getByText('No text attached yet.')).toBeInTheDocument()
    expect(within(text).getByText(/released with this request and indexed under/)).toBeInTheDocument()

    await user.upload(within(text).getByTestId('manifestation-text-file'), new File(['%PDF-1.7'], 'xa-guide-1-2020.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/texts/upload`, expect.objectContaining({ method: 'POST' })))
    const [, init] = fetchMock.mock.calls.find(([url]) => url === `${BASE}/texts/upload`) as [string, RequestInit]
    const form = init.body as FormData
    expect(form.get('manifestationKey')).toBe('xa-guide-1-2020-text')
    expect((form.get('file') as File).name).toBe('xa-guide-1-2020.pdf')
    await waitFor(() => expect(onAttached).toHaveBeenCalled())
  })

  test('in a draft, a URL on a configured source is sent to the request, never fetched by the browser', async () => {
    const user = userEvent.setup()
    show(undefined, true)

    const text = screen.getByTestId('manifestation-text')
    await user.click(within(text).getByRole('button', { name: 'Fetch from an address' }))
    await user.type(within(text).getByRole('textbox', { name: 'Source' }), 'xa-guides')
    await user.type(within(text).getByRole('textbox', { name: 'Address of the PDF' }), TEXT.url ?? '')
    await user.click(within(text).getByRole('button', { name: 'Fetch' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/texts`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ manifestationKey: 'xa-guide-1-2020-text', sourceId: 'xa-guides', url: TEXT.url }) })),
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('example.org'))).toBe(false)
  })

  test('read-only staff see no way to attach one', () => {
    show(undefined, false)

    const text = screen.getByTestId('manifestation-text')
    expect(within(text).getByText(/No text: this edition is listed only/)).toBeInTheDocument()
    expect(within(text).queryByRole('button')).not.toBeInTheDocument()
  })
})
