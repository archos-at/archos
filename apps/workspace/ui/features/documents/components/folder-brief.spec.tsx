/**
 * The folder brief as a reader meets it: the numbers add up, what needs them
 * comes first, the rest is folded to one line, and a long chip never breaks the
 * card. What is counted is specced in `../lib/folder-knowledge.spec.ts`.
 *
 * English, the default locale of an unprovided test tree.
 */

import type { ComponentProps } from 'react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { EMPTY_REVISION_LINKS } from '@/lib/documents/revision-links'
import type { ShelfSummary } from '@/lib/documents/shelf-summary-types'
import type { FileItem, FolderItem } from '../file-types'
import { buildFolderBrief, buildFolderBriefFromSummary } from '../lib/folder-knowledge'
import { FolderBrief } from './folder-brief'

let seq = 0
const file = (overrides: Partial<FileItem>): FileItem => ({
  id: `f${(seq += 1)}`,
  filename: 'doc.pdf',
  displayName: null,
  fileSize: 1,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: 'P',
  createdAt: '2026-01-01T00:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
  ...overrides,
})

const FOLDERS: FolderItem[] = [{ id: 'P', parentId: null, name: 'Pläne', path: 'Pläne' }]
const LONG_TOPIC = 'Brandabschnittsbildung zwischen Tiefgarage'

/** Three read, one failed, one held, one report Piloti never reads: 5 meant to read, 6 in all. */
const CORPUS: FileItem[] = [
  file({ tags: ['Grundriss', 'Brandschutz'], topics: [LONG_TOPIC] }),
  file({ tags: ['Grundriss'] }),
  file({ tags: ['Schnitt'] }),
  file({ status: 'failed' }),
  file({ status: 'quarantined' }),
  file({ status: 'stored' }),
]

const renderBrief = (
  files: FileItem[] = CORPUS,
  props: Partial<ComponentProps<typeof FolderBrief>> = {}
) => {
  const onSelect = vi.fn()
  render(
    <FolderBrief
      brief={buildFolderBrief(files, FOLDERS, null)}
      folderName={null}
      shelfKind="project"
      onSelect={onSelect}
      onOpenFolder={vi.fn()}
      onReadAgain={vi.fn()}
      collapsed={false}
      onCollapsedChange={vi.fn()}
      missing={[{ role: 'land_register_extract', label: 'Land register extract', buildingName: null }]}
      {...props}
    />
  )
  return { onSelect }
}

describe('FolderBrief — the numbers add up', () => {
  it('says the read count once, in the headline, and the legend adds the rest up to its „of N"', () => {
    renderBrief()
    expect(screen.getByText(/3 of 5 documents read/)).toBeInTheDocument()
    expect(screen.queryByTestId('folder-brief-state-readable')).not.toBeInTheDocument()
    const legendCounts = ['failed', 'held'].map((state) =>
      Number(screen.getByTestId(`folder-brief-state-${state}`).textContent?.match(/\d+/)?.[0])
    )
    expect(3 + legendCounts.reduce((a, b) => a + b, 0)).toBe(5)
    // The report is named beside the legend, plainly as an extra.
    expect(screen.getByTestId('folder-brief-state-unindexed')).toHaveTextContent('1 more not in the knowledge base')
    // Something is open, so there is a bar: a hairline, never a band.
    expect(document.querySelector('[data-slot="segment-meter"]')).toHaveClass('h-1')
  })

  // Ticket #38, topic 6: „Alle 27 Dokumente gelesen" over „dazu 16 nicht in der
  // Wissensbasis", a full green band, and 27 three times.
  it('is quiet when all is read: no bar, the count once, and „all" says which documents it means', () => {
    renderBrief([file({ tags: ['Grundriss'] }), file({ tags: ['Schnitt'] }), file({ status: 'stored' })], { missing: null })
    const brief = screen.getByTestId('folder-brief')
    expect(screen.getByTestId('folder-brief-toggle')).toHaveTextContent('All 2 knowledge-base documents read')
    expect(document.querySelector('[data-slot="segment-meter"]')).toBeNull()
    expect(screen.queryByTestId('folder-brief-state-readable')).not.toBeInTheDocument()
    expect(screen.getByTestId('folder-brief-state-unindexed')).toHaveTextContent('1 more not in the knowledge base')
    expect(brief.textContent?.match(/\b2\b/g)).toHaveLength(1)
  })

  it('draws nothing under the headline when all is read and nothing else is there to say', () => {
    renderBrief([file({ tags: ['Grundriss'] }), file({ tags: ['Schnitt'] })], { missing: null })
    expect(screen.getByTestId('folder-brief-toggle')).toHaveTextContent('All 2 documents read')
    expect(screen.queryByTestId('folder-brief-meter')).not.toBeInTheDocument()
  })

  it('counts one document with three Fassungen once, and never asks to re-read a replaced one', () => {
    const ref = (id: string) => ({ id, filename: `${id}.pdf` })
    renderBrief([
      file({ id: 'c', tags: ['Grundriss'], revision: { ...EMPTY_REVISION_LINKS, supersedes: [ref('b')] } }),
      file({
        id: 'b',
        status: 'failed',
        revision: { ...EMPTY_REVISION_LINKS, supersededBy: ref('c'), supersedes: [ref('a')] },
      }),
      file({ id: 'a', revision: { ...EMPTY_REVISION_LINKS, supersededBy: ref('b') } }),
    ])
    expect(screen.getByText(/The document is read/)).toBeInTheDocument()
    expect(screen.queryByTestId('folder-brief-needs-failed')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-brief-read-again')).not.toBeInTheDocument()
  })
})

describe('FolderBrief — what needs the reader comes first', () => {
  it('orders the body by what the reader has to do, and folds the reference sections', () => {
    renderBrief()
    const body = screen.getByTestId('folder-brief-sections')
    const order = [...body.children].map(
      (section) => section.getAttribute('data-testid') ?? section.getAttribute('aria-labelledby')
    )
    expect(order).toEqual([
      'folder-brief-needs',
      'folder-brief-missing',
      'folder-brief-about',
      'folder-brief-where',
    ])
    expect(screen.getByTestId('folder-brief-about')).toHaveAttribute('data-state', 'closed')
    expect(screen.queryByTestId('folder-brief-types')).not.toBeInTheDocument()
  })

  it('names what a folded section holds on its one line, and opens on a click', async () => {
    renderBrief()
    const toggle = screen.getByTestId('folder-brief-about-toggle')
    // A tag still stored in German reads as its translation in English (finding 21).
    expect(toggle).toHaveTextContent('Floor plan · Section · Fire safety')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('folder-brief-types')).toBeInTheDocument()
  })

  it('gives each „Show" its own accessible name', () => {
    renderBrief()
    expect(
      within(screen.getByTestId('folder-brief-needs-failed')).getByRole('button', {
        name: 'Show the failed document',
      })
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('folder-brief-needs-held')).getByRole('button', {
        name: 'Show the held-back document',
      })
    ).toBeInTheDocument()
  })
})

describe('FolderBrief — chips', () => {
  it('labels the type and discipline families, so they are told apart by a word', async () => {
    renderBrief()
    await userEvent.click(screen.getByTestId('folder-brief-about-toggle'))
    const types = screen.getByTestId('folder-brief-types')
    expect(within(types).getByText('Document type')).toBeInTheDocument()
    expect(within(types).getByText('Discipline')).toBeInTheDocument()
  })

  it('truncates a long topic inside the chip, keeps its count, and carries the full text on hover', async () => {
    renderBrief()
    await userEvent.click(screen.getByTestId('folder-brief-about-toggle'))
    const chip = screen.getByTestId(`folder-brief-topic-${LONG_TOPIC}`)
    expect(chip).toHaveClass('max-w-full')
    expect(within(chip).getByText(LONG_TOPIC)).toHaveClass('truncate')
    expect(within(chip).getByText('1')).toBeInTheDocument()
    expect(chip.getAttribute('title')).toContain(LONG_TOPIC)
  })
})

describe('FolderBrief — folded', () => {
  it('is one line naming the headline, with no bar, legend or sections, and asks to open on a click', async () => {
    const onCollapsedChange = vi.fn()
    renderBrief(CORPUS, { collapsed: true, onCollapsedChange })
    const line = screen.getByTestId('folder-brief-toggle')
    expect(line).toHaveTextContent(/3 of 5 documents read/)
    expect(line).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-slot="segment-meter"]')).toBeNull()
    expect(screen.queryByTestId('folder-brief-state-failed')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-brief-needs-failed')).not.toBeInTheDocument()
    await userEvent.click(line)
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  it('opens in place: the line clicked is the same element afterwards, now the open card\'s header', async () => {
    function Live() {
      const [collapsed, setCollapsed] = useState(true)
      return (
        <FolderBrief
          brief={buildFolderBrief(CORPUS, FOLDERS, null)}
          folderName={null}
          shelfKind="project"
          onSelect={vi.fn()}
          onOpenFolder={vi.fn()}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />
      )
    }
    render(<Live />)
    const line = screen.getByTestId('folder-brief-toggle')
    expect(screen.getByTestId('folder-brief')).toHaveAttribute('data-state', 'closed')

    await userEvent.click(line)
    // Not a swap for another element: the node the reader clicked is still there.
    expect(screen.getByTestId('folder-brief-toggle')).toBe(line)
    expect(line).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('folder-brief')).toHaveAttribute('data-state', 'open')
    expect(document.querySelector('[data-slot="segment-meter"]')).not.toBeNull()

    await userEvent.click(line)
    expect(screen.getByTestId('folder-brief-toggle')).toBe(line)
    expect(line).toHaveAttribute('aria-expanded', 'false')
  })
})

/**
 * The brief of a folder read page by page (ADR-0102): the counts are the shelf
 * summary's, and what Piloti put on the documents is loaded only when asked.
 */
describe('FolderBrief - from the shelf summary', () => {
  const SUMMARY: ShelfSummary = {
    folders: [{ folderId: 'P', total: 6, readable: 3, reading: 0, failed: 1, held: 1, unindexed: 1, latest: null }],
    failed: [{ id: 'f-failed', folderId: 'P' }],
    failedTruncated: false,
  }
  const renderPartial = (props: Partial<ComponentProps<typeof FolderBrief>> = {}) =>
    renderBrief(CORPUS, { brief: buildFolderBriefFromSummary(SUMMARY, FOLDERS, null), ...props })

  it('counts what the corpus brief counts, and still offers the re-read for the failed one', () => {
    renderPartial()
    expect(screen.getByTestId('folder-brief-needs-failed')).toBeInTheDocument()
    expect(screen.getByTestId('folder-brief-needs-held')).toBeInTheDocument()
    expect(screen.getByTestId('folder-brief-read-again')).toHaveTextContent('Read again')
  })

  it('does not claim Piloti recognised no document type: it offers to load what it did', async () => {
    const onLoadDetails = vi.fn()
    renderPartial({ onLoadDetails })
    await userEvent.click(screen.getByTestId('folder-brief-about-toggle'))
    expect(screen.queryByTestId('folder-brief-types')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('folder-brief-load-details'))
    expect(onLoadDetails).toHaveBeenCalledTimes(1)
  })

  it('says the details are on their way while the shelf is read', async () => {
    renderPartial({ onLoadDetails: vi.fn(), detailsLoading: true })
    await userEvent.click(screen.getByTestId('folder-brief-about-toggle'))
    expect(screen.getByTestId('folder-brief-load-details')).toBeDisabled()
  })
})

/**
 * What it found sits with what it read: one block on the listing's column. On dev (2026-11-10) the findings were a
 * bordered box from the page's left edge to its right, stacked over the brief's own line on the 1280px column.
 */
describe('FolderBrief — what it found', () => {
  const findings = {
    projectId: 'p1',
    response: {
      findings: [{ kind: 'missing_plan' as const, key: 'a4', label: 'A4', sources: [{ documentId: 'x', name: 'Katasterauszug.dxf', pages: [1, 2] }] }],
      documentCount: 2,
      truncated: false,
      document: null,
    },
  }
  const READ = [file({ tags: ['Grundriss'] }), file({ tags: ['Schnitt'] })]

  it('folded, says what it read quietly and what asks the reader as a chip of its own that opens the brief', async () => {
    // „1 finding“ was 13px of ink at the end of a grey sentence (review of 2026-11-10, finding 12).
    const onCollapsedChange = vi.fn()
    renderBrief(READ, { missing: null, collapsed: true, findings, onCollapsedChange })
    expect(screen.getByTestId('folder-brief-toggle')).toHaveTextContent(/^All 2 documents read in this project$/)
    const chip = screen.getByTestId('folder-brief-findings-count')
    expect(chip).toHaveAttribute('data-slot', 'asks-you-chip')
    expect(chip).toHaveTextContent('1 finding')
    expect(screen.queryByTestId('document-findings-panel')).not.toBeInTheDocument()
    await userEvent.click(chip)
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  it('opens to the findings as a section of the brief, under the id the upload report links to', () => {
    renderBrief(READ, { missing: null, findings })
    const section = screen.getByTestId('document-findings-panel')
    expect(section.closest('[data-testid="folder-brief"]')).not.toBeNull()
    expect(section).toHaveAttribute('id', 'document-findings')
    expect(within(section).getByTestId('finding-missing_plan')).toHaveTextContent('Drawing number A4 is referred to')
  })

  it('opens itself when the page is reached through the upload report’s link', () => {
    window.history.replaceState(null, '', '#document-findings')
    const onCollapsedChange = vi.fn()
    renderBrief(READ, { missing: null, collapsed: true, onCollapsedChange, findings })
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
    window.history.replaceState(null, '', '#')
  })

  it('speaks for a folder without the project’s findings, and names how far it reaches, not the folder the title names', () => {
    renderBrief(READ, { missing: null, collapsed: true, folderName: 'Pläne', findings })
    const toggle = screen.getByTestId('folder-brief-toggle')
    expect(toggle).toHaveTextContent('All 2 documents read in this folder')
    expect(toggle).not.toHaveTextContent('finding')
    expect(toggle).not.toHaveTextContent('Pläne')
  })
})
