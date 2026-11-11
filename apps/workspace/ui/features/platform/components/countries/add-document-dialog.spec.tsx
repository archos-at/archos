import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AddDocumentDialog } from './add-document-dialog'

/**
 * "Add a document" (Platform → a country → Works and editions): the URL and the
 * upload path, an existing and a new work, prefill from the name, and each
 * refusal worded as what to do. The routes are stood in for; the composition
 * behind them is `document-add-wire.spec.ts` and the services it calls.
 */

const WORKS = { works: [{ workKey: 'xx-rl-1', title: 'Mechanical resistance', designation: 'RL 1', kind: 'model_code', editions: [{ editionKey: 'xx-rl-1-2023', label: '2023' }] }] }
const ADDED = { changeRequestId: 'cr-9', changeRequestTitle: 'RL 1 2019', opened: true, workKey: 'xx-rl-1', editionKey: 'xx-rl-1-2019', manifestationKey: 'xx-rl-1-2019-text', sha256: 'a'.repeat(64) }

const fetchMock = vi.fn()

function serve(answer: () => Response = () => Response.json(ADDED, { status: 201 })) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/platform/knowledge/countries/XX/works') return Response.json(WORKS)
    if (init?.method === 'POST') return answer()
    return new Response('{}', { status: 404 })
  })
}

function renderDialog() {
  const onReview = vi.fn()
  const onAdded = vi.fn()
  render(<AddDocumentDialog countryId="XX" open onOpenChange={() => undefined} onAdded={onAdded} onReview={onReview} />)
  return { onReview, onAdded }
}

const posted = () => fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST') as [string, RequestInit] | undefined

describe('AddDocumentDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  test('a URL names an existing work and its year: prefilled, sent in one call, and "Review now" opens the request', async () => {
    serve()
    const user = userEvent.setup()
    const { onReview, onAdded } = renderDialog()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/platform/knowledge/countries/XX/works'))
    expect(screen.getByText(/the platform fetches the PDF itself/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('URL of the PDF'), 'https://publisher.example/files/rl-1-2019.pdf')
    await user.tab()
    expect(screen.getByLabelText('Edition, as printed')).toHaveValue('2019')
    expect(screen.getByTestId('add-document-work')).toHaveTextContent('RL 1 – Mechanical resistance')
    await user.click(screen.getByTestId('add-document-submit'))
    const [url, init] = posted() ?? ['', {}]
    expect(url).toBe('/api/platform/knowledge/countries/XX/documents')
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://publisher.example/files/rl-1-2019.pdf', work: { workKey: 'xx-rl-1' }, label: '2019', inForceFrom: null })
    expect(await screen.findByTestId('add-document-done')).toHaveTextContent('Added to a new change request, “RL 1 2019”')
    expect(onAdded).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Review now' }))
    expect(onReview).toHaveBeenCalledWith('cr-9')
  })

  test('an upload of a new work sends the file, the work as JSON and the title lines', async () => {
    serve(() => Response.json({ ...ADDED, opened: false, changeRequestTitle: 'Open draft' }, { status: 201 }))
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await user.click(screen.getByRole('radio', { name: 'Upload a file' }))
    await user.click(screen.getByRole('radio', { name: 'A new work' }))
    await user.upload(screen.getByLabelText('PDF file'), new File(['%PDF-1.7'], 'guide-2024.pdf', { type: 'application/pdf' }))
    await user.type(screen.getByLabelText('Where the publisher publishes it'), 'https://publisher.example/guides')
    await user.type(screen.getByLabelText('Title lines as the document prints them'), 'Fire safety guide, edition 2024')
    expect(screen.getByLabelText('Title of the work')).toHaveValue('guide 2024')
    await user.clear(screen.getByLabelText('Title of the work'))
    await user.type(screen.getByLabelText('Title of the work'), 'Fire safety guide')
    expect(screen.getByLabelText('Edition, as printed')).toHaveValue('2024')
    await user.click(screen.getByTestId('add-document-submit'))
    const [url, init] = posted() ?? ['', {}]
    expect(url).toBe('/api/platform/knowledge/countries/XX/documents/upload')
    const form = init.body as FormData
    expect((form.get('file') as File).name).toBe('guide-2024.pdf')
    expect(JSON.parse(String(form.get('work')))).toEqual({ title: 'Fire safety guide', designation: null, kind: 'statute' })
    expect(form.get('titleText')).toBe('Fire safety guide, edition 2024')
    expect(await screen.findByTestId('add-document-done')).toHaveTextContent('Added to the change request “Open draft”')
  })

  test('a file that is not a PDF is refused before anything is sent', async () => {
    serve()
    const user = userEvent.setup({ applyAccept: false })
    renderDialog()
    await user.click(screen.getByRole('radio', { name: 'Upload a file' }))
    await user.upload(screen.getByLabelText('PDF file'), new File(['x'], 'notes.docx', { type: 'application/msword' }))
    expect(screen.getByTestId('add-document-error')).toHaveTextContent('That is not a PDF')
    expect(posted()).toBeUndefined()
  })

  test.each([
    ['EDITION_EXISTS', 409, 'This work already has that edition'],
    ['HOST_NOT_ON_SOURCE', 422, 'This address is on none of this country’s sources'],
    ['NOT_A_PDF', 422, 'That is not a PDF'],
    ['NOT_PRINTED', 422, 'The document does not print the designation or the edition as entered'],
  ])('the refusal %s says what to do', async (code, status, words) => {
    serve(() => Response.json({ code, detail: 'server words' }, { status }))
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await user.type(screen.getByLabelText('URL of the PDF'), 'https://elsewhere.example/rl-1-2023.pdf')
    await user.tab()
    await user.click(screen.getByTestId('add-document-submit'))
    expect(await screen.findByTestId('add-document-error')).toHaveTextContent(words)
    expect(screen.queryByTestId('add-document-done')).not.toBeInTheDocument()
  })
})
