import { render, screen, waitFor } from '@/test-utils'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RisDocumentDialog } from './ris-document-dialog'
import { PRODUCT_NAME } from '@/lib/brand'

const TEXT = [
  '§ 1 Geltungsbereich',
  'Dieses Gesetz gilt für Bauvorhaben im Land Wien.',
  '§ 2 Begriffsbestimmungen',
].join('\n')

const respondWith = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

const open = (props: Partial<Parameters<typeof RisDocumentDialog>[0]> = {}) =>
  render(
    <RisDocumentDialog
      open
      onOpenChange={() => {}}
      url="https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000009"
      title="Bauordnung für Wien"
      {...props}
    />
  )

describe('RisDocumentDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        url: 'https://www.ris.bka.gv.at/x',
        title: 'Bauordnung für Wien',
        text: TEXT,
        truncated: false,
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('a closed dialog fetches nothing', () => {
    open({ open: false })

    expect(fetch).not.toHaveBeenCalled()
  })

  test('the cited passage travels with the request and is marked in the text', async () => {
    const passage = 'Dieses Gesetz gilt für Bauvorhaben im Land Wien.'
    open({ highlight: passage })

    await waitFor(() => expect(document.querySelector('mark')).not.toBeNull())
    expect(document.querySelector('mark')!.textContent).toBe(passage.replace(/\.$/, ''))

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const requested = new URL(calls[0]![0] as string, 'http://localhost')
    expect(requested.searchParams.get('passage')).toBe(passage)
  })

  test('a passage that is not in the document leaves the text unmarked', async () => {
    open({ highlight: 'Ein Satz, der nirgends steht.' })

    await waitFor(() => expect(screen.getByText(/Geltungsbereich/)).toBeInTheDocument())
    expect(document.querySelector('mark')).toBeNull()
  })

  test('a rate limit is not reported as a broken source', async () => {
    vi.stubGlobal('fetch', respondWith({ error: 'rate limited' }, 429))
    open()

    expect(
      await screen.findByText(/Too many requests in a row/)
    ).toBeInTheDocument()
  })

  test('an unreachable document says so, and the link to RIS stays', async () => {
    vi.stubGlobal('fetch', respondWith({ error: 'upstream' }, 502))
    open()

    expect(
      await screen.findByText(new RegExp(String.raw`cannot be shown in ${PRODUCT_NAME} right now`))
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open at RIS/ })).toHaveAttribute(
      'href',
      expect.stringContaining('ris.bka.gv.at')
    )
  })
})
