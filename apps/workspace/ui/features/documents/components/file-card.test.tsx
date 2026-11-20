import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { FileCard, ThumbnailWithFallback, resetThumbnailCache } from './file-card'
import type { FileItem } from './project-file-workspace'
import { PRODUCT_NAME } from '@/lib/brand'

function file(id: string, filename: string, contentType: string | null): FileItem {
  return {
    id,
    filename,
    displayName: null,
    fileSize: 1024,
    contentType,
    status: 'ready',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
  }
}

afterEach(() => resetThumbnailCache())

describe('ThumbnailWithFallback', () => {
  it('shows a skeleton while the thumbnail request is in flight, then the image', async () => {
    server.use(
      http.get('/api/documents/:id/thumbnail', () => HttpResponse.json({ url: 'https://cdn.test/t.png' }))
    )

    const { container } = render(<ThumbnailWithFallback file={file('i1', 'Foto.png', 'image/png')} />)

    expect(screen.getByTestId('thumbnail-skeleton')).toBeInTheDocument()

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument())
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/t.png')
  })

  it('falls back to a WARM image placeholder with a format chip when no thumbnail exists', async () => {
    server.use(http.get('/api/documents/:id/thumbnail', () => HttpResponse.json({ url: null })))

    render(<ThumbnailWithFallback file={file('i2', 'Fassade.png', 'image/png')} />)

    await waitFor(() => {
      const tile = screen.getByTestId('document-kind-thumbnail')
      expect(tile).toHaveAttribute('data-state', 'placeholder')
      expect(tile).toHaveAttribute('data-kind', 'photo')
    })
    expect(screen.getByText('PNG')).toBeInTheDocument()
  })

  it('asks for an office file\'s thumbnail, rendered from its PDF rendition (ADR-0070)', async () => {
    server.use(
      http.get('/api/documents/:id/thumbnail', () => HttpResponse.json({ url: 'https://cdn.test/d.jpg' }))
    )

    const { container } = render(
      <ThumbnailWithFallback
        file={file(
          'o1',
          'Raumprogramm.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )}
      />
    )

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/d.jpg'))
  })

  it('draws the kind sketch for an office file that has no thumbnail yet', async () => {
    server.use(http.get('/api/documents/:id/thumbnail', () => HttpResponse.json({ url: null })))

    render(<ThumbnailWithFallback file={file('o2', 'Kosten.xlsx', null)} />)

    await waitFor(() =>
      expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'placeholder')
    )
  })

  it('treats a 404 as "no thumbnail" (warm placeholder), not a failure', async () => {
    server.use(http.get('/api/documents/:id/thumbnail', () => HttpResponse.json({}, { status: 404 })))

    render(<ThumbnailWithFallback file={file('i3', 'Bild.jpg', 'image/jpeg')} />)

    await waitFor(() =>
      expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'placeholder')
    )
  })

  it('shows the distinct "couldn\'t load" treatment ONLY on a genuine failure (5xx)', async () => {
    server.use(http.get('/api/documents/:id/thumbnail', () => HttpResponse.json({}, { status: 500 })))

    render(<ThumbnailWithFallback file={file('i4', 'Plan.png', 'image/png')} />)

    await waitFor(() =>
      expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'failed')
    )
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument()
  })

  it('de-dups the thumbnail fetch per file id via the module cache', async () => {
    const hits = vi.fn()
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits()
        return HttpResponse.json({ url: null })
      })
    )

    const f = file('i5', 'Foto.png', 'image/png')
    render(
      <>
        <ThumbnailWithFallback file={f} />
        <ThumbnailWithFallback file={f} />
      </>
    )

    await waitFor(() => expect(screen.getAllByTestId('document-kind-thumbnail')).toHaveLength(2))
    expect(hits).toHaveBeenCalledTimes(1)
  })

  it('re-asks once the cached signed url has expired, instead of replaying it (#366)', async () => {
    const nowS = Math.floor(Date.now() / 1000)
    const urls = [
      `/api/documents/i9/image?org=o&v=thumb&exp=${nowS + 30}&sig=a`,
      `/api/documents/i9/image?org=o&v=thumb&exp=${nowS + 3600}&sig=b`,
    ]
    const hits = vi.fn()
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits()
        return HttpResponse.json({ url: urls[hits.mock.calls.length - 1] })
      })
    )
    const f = file('i9', 'Plan.pdf', 'application/pdf')

    const first = render(<ThumbnailWithFallback file={f} />)
    await waitFor(() => expect(hits).toHaveBeenCalledTimes(1))
    first.unmount()
    render(<ThumbnailWithFallback file={f} />)
    await waitFor(() => expect(hits).toHaveBeenCalledTimes(2))
  })

  it('keeps a signed url that is still valid', async () => {
    const nowS = Math.floor(Date.now() / 1000)
    const hits = vi.fn()
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits()
        return HttpResponse.json({ url: `/api/documents/i10/image?v=thumb&exp=${nowS + 3600}&sig=a` })
      })
    )
    const f = file('i10', 'Plan.pdf', 'application/pdf')
    const first = render(<ThumbnailWithFallback file={f} />)
    await waitFor(() => expect(hits).toHaveBeenCalledTimes(1))
    first.unmount()
    render(<ThumbnailWithFallback file={f} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hits).toHaveBeenCalledTimes(1)
  })

  it('re-asks after ingestion finishes when the document had no preview yet', async () => {
    let hits = 0
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits += 1
        return HttpResponse.json({ url: hits === 1 ? null : '/api/documents/i6/image?sig=abc' })
      })
    )

    const uploading = { ...file('i6', 'Schnitt.pdf', 'application/pdf'), status: 'processing' }
    const { rerender, container } = render(<ThumbnailWithFallback file={uploading} />)

    await waitFor(() =>
      expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'placeholder')
    )

    rerender(<ThumbnailWithFallback file={{ ...uploading, status: 'ready' }} />)

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument())
    expect(hits).toBe(2)
  })

  it('does not re-ask a settled document that genuinely has no thumbnail', async () => {
    let hits = 0
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits += 1
        return HttpResponse.json({ url: null })
      })
    )

    const settled = file('i7', 'Foto.png', 'image/png')
    const { rerender } = render(<ThumbnailWithFallback file={settled} />)

    await waitFor(() =>
      expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'placeholder')
    )

    rerender(<ThumbnailWithFallback file={{ ...settled }} />)
    await waitFor(() => expect(hits).toBe(1))
  })

  it('does not fetch for a type that cannot have a thumbnail — warm sketch immediately', async () => {
    const hits = vi.fn()
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits()
        return HttpResponse.json({ url: null })
      })
    )

    render(<ThumbnailWithFallback file={file('d1', 'Zeichnung.dwg', 'application/acad')} />)

    expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'placeholder')
    expect(screen.queryByTestId('thumbnail-skeleton')).not.toBeInTheDocument()
    expect(hits).not.toHaveBeenCalled()
  })
})

describe('FileCard while the document is still being read', () => {
  const unsettled: FileItem = { ...file('c1', 'Schnitt.pdf', 'application/pdf'), status: 'processing' }

  it('sets the meta line right under the name, not at the foot of the cell', () => {
    render(<FileCard file={unsettled} isSelected={false} onSelect={() => {}} locale="de" />)

    const card = screen.getByTestId('file-card')
    const footer = screen.getByTestId('file-card-footer')
    expect(card.nextElementSibling).toBe(footer)
    expect(footer.className.split(/\s+/)).not.toContain('flex-1')
    expect(footer.className).not.toContain('content-end')
  })

  it('carries no description on a Dateien tile: the sheet, the name and one meta line', () => {
    const summarized: FileItem = { ...unsettled, status: 'ready', summary: 'Perspektivischer Schnitt, Bauteil A.' }
    const { unmount } = render(<FileCard file={summarized} isSelected={false} onSelect={() => {}} locale="de" />)
    expect(screen.queryByText('Perspektivischer Schnitt, Bauteil A.')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-card-footer')).toHaveTextContent('PDF')
    unmount()

    render(<FileCard file={unsettled} isSelected={false} onSelect={() => {}} locale="de" />)
    expect(screen.queryByTestId('file-card-summary-skeleton')).not.toBeInTheDocument()
  })

  it('keeps the summary as the second line of a card without a meta line (the chat), holding its slot while it is read', () => {
    const { unmount } = render(<FileCard file={unsettled} isSelected={false} onSelect={() => {}} locale="de" hideFooter />)
    expect(screen.getByTestId('file-card-summary-skeleton')).toHaveAttribute('aria-hidden')
    unmount()

    const summarized: FileItem = { ...unsettled, status: 'ready', summary: 'Perspektivischer Schnitt, Bauteil A.' }
    render(<FileCard file={summarized} isSelected={false} onSelect={() => {}} locale="de" hideFooter />)
    expect(screen.queryByTestId('file-card-summary-skeleton')).not.toBeInTheDocument()
    expect(screen.getByText('Perspektivischer Schnitt, Bauteil A.')).toBeInTheDocument()
  })

  it('shows the failure reason rather than a skeleton when ingestion failed', () => {
    const failed: FileItem = { ...unsettled, status: 'failed', errorMessage: 'Verschlüsseltes PDF' }

    render(<FileCard file={failed} isSelected={false} onSelect={() => {}} locale="de" />)

    expect(screen.queryByTestId('file-card-summary-skeleton')).not.toBeInTheDocument()
    const line = screen.getByTestId('file-card-failure')
    expect(line).toHaveTextContent(new RegExp(`${PRODUCT_NAME} (couldn't read|konnte dieses Dokument nicht lesen)`))
    expect(line).toHaveAttribute('title', 'Verschlüsseltes PDF')
  })

  it('says why in words when the failure carries a known backend prefix', () => {
    const failed: FileItem = {
      ...unsettled,
      status: 'failed',
      errorMessage: 'pdf_pages_unreadable: 7 of 12 pages could not be read',
    }

    render(<FileCard file={failed} isSelected={false} onSelect={() => {}} locale="de" />)

    const line = screen.getByTestId('file-card-failure')
    expect(line).toHaveTextContent(/^7 (of|von) 12/)
    expect(line).not.toHaveTextContent('pdf_pages_unreadable')
    expect(line).toHaveAttribute('title', 'pdf_pages_unreadable: 7 of 12 pages could not be read')
  })

  it('omits the size · time strip when hideFooter is set', () => {
    render(
      <FileCard
        file={file('c2', 'Schnitt.pdf', 'application/pdf')}
        isSelected={false}
        onSelect={() => {}}
        locale="en"
        hideFooter
      />,
    )

    const card = screen.getByTestId('file-card')
    expect(card.lastElementChild?.className).toContain('flex-1')
    expect(screen.queryByText(/KB|MB/)).not.toBeInTheDocument()
  })

  it('shows the rename, and still reads the format from the file itself', () => {
    render(
      <FileCard
        file={{ ...file('doc-1', 'plan.pdf', 'application/pdf'), displayName: 'Einreichplan EG.pdf' }}
        isSelected={false}
        onSelect={vi.fn()}
        locale="de"
      />
    )

    expect(screen.getByText('Einreichplan EG.pdf')).toBeInTheDocument()
    expect(screen.queryByText('plan.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
  })
})

describe('FileCard for a report the agent wrote', () => {
  const generated: FileItem = {
    ...file('g1', 'Tiefenrecherche_Brandschutz.pdf', 'application/pdf'),
    status: 'stored',
    authoredBy: 'agent',
    summary: 'Rechercheergebnis zu Fluchtwegen in der Gebäudeklasse 4.',
  }

  it('names its author under the file name, as a line and not a chip', () => {
    render(<FileCard file={generated} isSelected={false} onSelect={() => {}} locale="de" />)

    const byline = screen.getByText(`Created by ${PRODUCT_NAME}`)
    expect(byline.tagName).toBe('P')
    expect(screen.getByTestId('file-card')).toContainElement(byline)
    expect(screen.getByTestId('file-card-footer')).not.toContainElement(byline)
  })

  it('stays silent about authorship for an uploaded file', () => {
    render(
      <FileCard file={{ ...generated, authoredBy: 'user', status: 'ready' }} isSelected={false} onSelect={() => {}} locale="de" />,
    )

    expect(screen.queryByText(`Created by ${PRODUCT_NAME}`)).not.toBeInTheDocument()
  })

  it('badges `stored` as neither citable nor failed', () => {
    render(<FileCard file={generated} isSelected={false} onSelect={() => {}} locale="de" />)

    expect(screen.getByText('Filed')).toBeInTheDocument()
    expect(screen.queryByText('Citable')).not.toBeInTheDocument()
  })
})

describe('FileCard headlines carry no version numbers', () => {
  const uploaded = file('u1', 'Einreichplan.pdf', 'application/pdf')

  it('numbers nothing on a single version — the state word stands alone, never Vn', () => {
    render(
      <FileCard
        file={{ ...uploaded, versionState: 'published', versionCount: 1 }}
        isSelected={false}
        onSelect={() => {}}
        locale="de"
      />,
    )

    const card = screen.getByTestId('file-card')
    const footer = screen.getByTestId('file-card-footer')
    expect(card.textContent).not.toMatch(/\bv\d+\b/i)
    expect(footer.textContent).not.toMatch(/\bv\d+\b/i)
    expect(footer.textContent).toMatch('1 kB')
    expect(footer.querySelector('time')).toBeInTheDocument()
  })

  it('states the word once the document has a history — and still no number', () => {
    render(
      <FileCard
        file={{ ...uploaded, versionState: 'in_review', versionCount: 2 }}
        isSelected={false}
        onSelect={() => {}}
        locale="de"
      />,
    )

    expect(screen.getAllByTestId('document-version-badge')).toHaveLength(1)
    expect(screen.getByTestId('document-version-badge')).toHaveTextContent('In review')
    expect(screen.getByTestId('file-card').textContent).not.toMatch(/\bv\d+\b/i)
  })
})

describe('FileCard asks for its thumbnail once it has been seen', () => {
  let restoreObservers: (() => void) | null = null
  afterEach(() => {
    restoreObservers?.()
    restoreObservers = null
  })

  const countThumbnailRequests = () => {
    const hits = vi.fn()
    server.use(
      http.get('/api/documents/:id/thumbnail', () => {
        hits()
        return HttpResponse.json({ url: null })
      })
    )
    return hits
  }

  it('does not ask for a card that has not been on screen, and holds the skeleton', async () => {
    const hits = countThumbnailRequests()
    restoreObservers = installLayoutObservers({ intersecting: false })

    render(<FileCard file={file('v1', 'Plan.pdf', 'application/pdf')} isSelected={false} onSelect={() => {}} locale="de" />)

    expect(screen.getByTestId('thumbnail-skeleton')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hits).not.toHaveBeenCalled()
    expect(screen.getByTestId('thumbnail-skeleton')).toBeInTheDocument()
  })

  it('asks once the card comes on screen', async () => {
    const hits = countThumbnailRequests()
    restoreObservers = installLayoutObservers({ intersecting: true })

    render(<FileCard file={file('v2', 'Plan.pdf', 'application/pdf')} isSelected={false} onSelect={() => {}} locale="de" />)

    await waitFor(() =>
      expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-state', 'placeholder')
    )
    expect(hits).toHaveBeenCalledTimes(1)
  })
})

describe('FileCard and the version state badge', () => {
  const uploaded = file('u1', 'Einreichplan.pdf', 'application/pdf')

  it('says nothing on a plain upload', () => {
    render(
      <FileCard
        file={{ ...uploaded, versionState: 'published', versionCount: 1 }}
        isSelected={false}
        onSelect={() => {}}
        locale="de"
      />,
    )

    expect(screen.queryByTestId('document-version-badge')).not.toBeInTheDocument()
  })

  it('speaks once the document has a history', () => {
    render(
      <FileCard
        file={{ ...uploaded, versionState: 'in_review', versionCount: 2 }}
        isSelected={false}
        onSelect={() => {}}
        locale="de"
      />,
    )

    expect(screen.getByTestId('document-version-badge')).toHaveTextContent('In review')
  })

  it('stays silent on a first draft the agent wrote — one version is no history', () => {
    render(
      <FileCard
        file={{
          ...uploaded,
          authoredBy: 'agent',
          status: 'stored',
          versionState: 'draft',
          versionCount: 1,
        }}
        isSelected={false}
        onSelect={() => {}}
        locale="de"
      />,
    )

    expect(screen.queryByTestId('document-version-badge')).not.toBeInTheDocument()
    expect(screen.getByText(`Created by ${PRODUCT_NAME}`)).toBeInTheDocument()
  })

  it('says nothing when the listing never read the state', () => {
    render(<FileCard file={uploaded} isSelected={false} onSelect={() => {}} locale="de" />)

    expect(screen.queryByTestId('document-version-badge')).not.toBeInTheDocument()
  })
})

describe('FileCard: an E-Mail-Verlauf', () => {
  const verlauf: FileItem = {
    ...file('v1', 'Stellplatznachweis.md', 'text/markdown'),
    tags: ['correspondence'],
    versionCount: 3,
    versionState: 'published',
    mailThread: { entryCount: 3, lastEntryAt: '2026-10-14T07:12:00Z' },
  }

  it('reads as the conversation it is, not as a Markdown file with a Freigabe', () => {
    render(<FileCard file={verlauf} isSelected={false} onSelect={() => {}} locale="en" />)
    const card = screen.getByTestId('file-card')
    expect(card).toHaveTextContent('Stellplatznachweis')
    expect(card).not.toHaveTextContent('.md')
    expect(screen.getByTestId('mail-thread-file-facts')).toHaveTextContent(/^3 mails · last /)
    expect(screen.getByTestId('document-kind-thumbnail')).toHaveAttribute('data-kind', 'mail-thread')
    expect(screen.queryByTestId('document-version-badge')).not.toBeInTheDocument()
    const footer = screen.getByTestId('file-card-footer')
    expect(footer).toHaveTextContent('Mail thread')
    expect(footer).not.toHaveTextContent(/MD|1 KB/i)
  })

  it('leaves a Markdown file that is no Verlauf a Markdown file', () => {
    render(<FileCard file={{ ...verlauf, mailThread: null }} isSelected={false} onSelect={() => {}} locale="en" />)
    expect(screen.getByTestId('file-card')).toHaveTextContent('Stellplatznachweis.md')
    expect(screen.queryByTestId('mail-thread-file-facts')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-card-footer')).toHaveTextContent('MD')
  })
})
