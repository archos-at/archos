import { render, screen } from '@/test-utils'
import { chatCopy } from '@/i18n/namespaces/chat'
import { describe, test, expect } from 'vitest'
import { SourceCard } from './SourceCard'
import type { CitedDocument } from '../../lib/citations'
import type { Shelf } from '@/lib/source-kinds'

const document = (shelf: Shelf | undefined): CitedDocument => ({
  id: 'doc:s_9f2a4c:grundriss.pdf',
  title: 'Grundriss',
  fileName: 'Grundriss.pdf',
  collection: 's_9f2a4c',
  shelf,
  kind: 'project',
  tint: 'project',
  loci: [{ key: 'p:2', page: 2, isCited: true, number: 1 }],
})

const renderCard = (shelf: Shelf | undefined) => render(<SourceCard document={document(shelf)} />)

describe('SourceCard — provenance tab', () => {
  test('a private session attachment is not labelled Projektwissen', () => {
    renderCard('session')

    expect(screen.getByText(chatCopy.messages.en.sourceTabs.shelves.session)).toBeInTheDocument()
    expect(screen.queryByText(chatCopy.messages.en.sourceTabs.shelves.project)).not.toBeInTheDocument()
  })

  test('a project document is labelled Projektwissen', () => {
    renderCard('project')

    expect(screen.getByText(chatCopy.messages.en.sourceTabs.shelves.project)).toBeInTheDocument()
  })

  test('an org office shelf document is labelled office shelf', () => {
    renderCard('office_shelf')

    expect(screen.getByText(chatCopy.messages.en.sourceTabs.shelves.office_shelf)).toBeInTheDocument()
  })

  test('a document with no shelf claims none — it falls back to its display kind', () => {
    renderCard(undefined)

    expect(screen.getByText(chatCopy.messages.en.sourceTabs.shelves.project)).toBeInTheDocument()
    expect(screen.queryByText(chatCopy.messages.en.sourceTabs.shelves.session)).not.toBeInTheDocument()
  })
})
