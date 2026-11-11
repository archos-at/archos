/**
 * „Piloti hat sich gemerkt" — the chip that tells a reader what one turn made
 * durable about their project (`docs/architecture/post-answer-stages.md` §1.1).
 *
 * The one thing this component must never do is COLLAPSE the two paths. A
 * finding the reader themselves authorised mid-answer and a finding the machine
 * distilled after the answer are different promises: the first they agreed to,
 * the second happened without them. The chip is where they are told apart, and
 * the label is the only place that distinction survives — the popover shows the
 * same words for both otherwise.
 */
import type { JSX } from 'react'
import { cleanup, render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { MemoryNotedChip, MemoryNotedChipView } from './MemoryNotedChip'
import { resetTurnNotes, type NoteRemoval } from '../stores/turn-notes-store'
import type { TurnMemoryAudience, TurnMemoryItem } from '../lib/turn-memory'
import { PRODUCT_NAME } from '@/lib/brand'

const inTurn: TurnMemoryItem = {
  id: 'memory_proposal-0',
  kind: 'constraint',
  content: 'Die Fluchtwegbreite ist mit 1,20 m vorgegeben.',
  provenance: 'inTurn',
}

const afterwards: TurnMemoryItem = {
  id: 'row-1',
  kind: 'derived_fact',
  content: 'Das oberste Fluchtniveau beträgt 9,80 m.',
  provenance: 'distillation',
}

/** The note as a turn records it once it knows the shelf, but not the stored row (an older card). */
const inProject = (item: TurnMemoryItem): TurnMemoryItem => ({ ...item, audience: 'project' })
/** The note as the stage frame carries it: its shelf and the id of the stored row. */
const saved = (item: TurnMemoryItem, audience: TurnMemoryAudience): TurnMemoryItem => ({ ...item, audience, noteId: item.id })

/** One of the reader's own personal notes, saved under this answer. */
const mine: TurnMemoryItem = {
  id: 'p-1',
  noteId: 'p-1',
  kind: 'profile',
  content: 'Leitet die Einreichplanung.',
  provenance: 'distillation',
  audience: 'personal',
}

describe('MemoryNotedChip', () => {
  test('renders nothing for a turn that recorded nothing', () => {
    // Which is most turns. Reflection's most common correct outcome is "nothing
    // durable here", and an empty popover trigger would be a promise of content.
    const { container } = render(<MemoryNotedChip items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('counts what this turn recorded', () => {
    render(<MemoryNotedChip items={[inTurn, afterwards]} />)
    expect(screen.getByText(`${PRODUCT_NAME} noted`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${PRODUCT_NAME} noted 2 items` })).toBeInTheDocument()
  })

  test('labels the in-turn write and the post-answer one apart', async () => {
    const user = userEvent.setup()
    render(<MemoryNotedChip items={[inTurn, afterwards]} />)

    await user.click(screen.getByRole('button', { name: `${PRODUCT_NAME} noted 2 items` }))

    expect(await screen.findByText('noted during the response')).toBeInTheDocument()
    expect(screen.getByText('added after the response')).toBeInTheDocument()
    // Both are shown in the reader's own words, verbatim — the chip is a record
    // of what is now in their project, not a summary of it.
    expect(screen.getByText(inTurn.content)).toBeInTheDocument()
    expect(screen.getByText(afterwards.content)).toBeInTheDocument()
    expect(screen.getByText('Constraint')).toBeInTheDocument()
    expect(screen.getByText('Fact')).toBeInTheDocument()
  })

  test('opens in one tap from the keyboard as a named dialog listing every item', async () => {
    const user = userEvent.setup()
    render(<MemoryNotedChip items={[inProject(inTurn), inProject(afterwards)]} />)

    await user.tab()
    expect(screen.getByRole('button', { name: `${PRODUCT_NAME} noted 2 items` })).toHaveFocus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog', { name: 'Added to project memory' })
    expect(dialog).toHaveAccessibleDescription(/manage and delete/)
    expect(screen.getAllByTestId('memory-item')).toHaveLength(2)
    expect(screen.queryByTestId('memory-item-supersedes')).not.toBeInTheDocument()
  })

  describe('a turn that CORRECTED an earlier note', () => {
    const correction: TurnMemoryItem = {
      id: 'memory_proposal-1',
      kind: 'constraint',
      content: 'Die Fluchtwegbreite ist mit 1,50 m vorgegeben.',
      provenance: 'inTurn',
      supersedes: inTurn.content,
    }

    test('says so on the chip itself, not only inside it', () => {
      render(<MemoryNotedChip items={[afterwards, correction]} />)
      const chip = screen.getByTestId('memory-chip')
      expect(chip).toHaveTextContent('Memory updated')
      expect(chip).toHaveAttribute('data-state-kind', 'updated')
      expect(chip).toHaveAccessibleName(`${PRODUCT_NAME} updated its memory: 2 items, 1 of them corrected`)
    })

    test('lists the correction first, with the note it retired struck through', async () => {
      const user = userEvent.setup()
      render(<MemoryNotedChip items={[inProject(afterwards), inProject(correction)]} />)

      await user.click(screen.getByTestId('memory-chip'))

      expect(await screen.findByRole('dialog', { name: 'Project memory updated' })).toBeInTheDocument()
      const [first, second] = screen.getAllByTestId('memory-item')
      expect(first).toHaveTextContent(correction.content)
      expect(first).toHaveTextContent('Corrected')
      expect(second).toHaveTextContent(afterwards.content)
      const replaced = screen.getByTestId('memory-item-supersedes')
      expect(replaced).toHaveTextContent(`Replaces: ${inTurn.content}`)
      expect(replaced.querySelector('del')).toHaveTextContent(inTurn.content)
    })

    test('an add-only turn keeps the quieter label', () => {
      render(<MemoryNotedChip items={[afterwards]} />)
      expect(screen.getByTestId('memory-chip')).toHaveAttribute('data-state-kind', 'added')
    })
  })

  test('speaks German from the German dictionary', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider initialLocale="de" fixedLocale>
        <MemoryNotedChip
          items={[
            inProject(afterwards),
            inProject({ ...inTurn, id: 'c', supersedes: 'Die Fluchtwegbreite ist mit 1,00 m vorgegeben.' }),
          ]}
        />
      </I18nProvider>
    )
    expect(screen.getByTestId('memory-chip')).toHaveTextContent('Gedächtnis aktualisiert')
    await user.click(screen.getByTestId('memory-chip'))
    expect(await screen.findByRole('dialog', { name: 'Projektgedächtnis aktualisiert' })).toBeInTheDocument()
    expect(screen.getByText('Korrigiert')).toBeInTheDocument()
    expect(screen.getByTestId('memory-item-supersedes')).toHaveTextContent(/^Ersetzt:/)
  })
  test('says who reads each note, by where it was kept (ADR-0180)', async () => {
    const user = userEvent.setup()
    render(
      <MemoryNotedChip
        projectId="p-1"
        items={[
          { ...inTurn, audience: 'organization' },
          { ...afterwards, audience: 'project' },
        ]}
      />
    )
    await user.click(screen.getByTestId('memory-chip'))

    const audiences = screen.getAllByTestId('memory-item-audience').map((node) => node.textContent)
    expect(audiences).toEqual(['Read by everyone in the office', 'Read by the project team'])
  })

  test('a note whose home was not recorded claims no audience', async () => {
    const user = userEvent.setup()
    render(<MemoryNotedChip projectId="p-1" items={[inTurn]} />)
    await user.click(screen.getByTestId('memory-chip'))

    expect(screen.queryByTestId('memory-item-audience')).not.toBeInTheDocument()
  })

  test('the hint is a link to the project’s memory, where the notes are managed', async () => {
    const user = userEvent.setup()
    render(<MemoryNotedChip projectId="p 1" items={[afterwards]} />)
    await user.click(screen.getByTestId('memory-chip'))

    const link = screen.getByRole('link', { name: 'Manage in project memory' })
    expect(link).toHaveAttribute('href', '/app/projects/p%201/settings/memory')
  })

  test('outside a project there is no page to link to: the hint stays a sentence', async () => {
    const user = userEvent.setup()
    render(<MemoryNotedChip projectId={null} items={[afterwards]} />)
    await user.click(screen.getByTestId('memory-chip'))

    expect(screen.queryByTestId('memory-manage-link')).not.toBeInTheDocument()
    expect(screen.getByText('You can manage and delete these entries in a project’s memory.')).toBeInTheDocument()
  })

  describe('the panel names the memory the notes went into', () => {
    const titleOf = async (items: TurnMemoryItem[]): Promise<string | null> => {
      const user = userEvent.setup()
      const { unmount } = render(<MemoryNotedChipView items={items} projectId="p-1" />)
      await user.click(screen.getByTestId('memory-chip'))
      const title = (await screen.findByRole('dialog')).querySelector('[data-slot="note-panel-title"]')?.textContent ?? null
      unmount()
      return title
    }

    test('office notes are not called project memory', async () => {
      expect(await titleOf([{ ...inTurn, audience: 'organization' }])).toBe('Added to office memory')
      expect(await titleOf([{ ...inTurn, audience: 'organization', supersedes: 'Alt.' }])).toBe('Office memory updated')
    })

    test('a personal note went into the reader’s own memory, a restricted one into the project’s', async () => {
      expect(await titleOf([mine])).toBe('Added to your memory')
      expect(await titleOf([{ ...afterwards, audience: 'restricted' }, inProject(inTurn)])).toBe('Added to project memory')
    })

    test('notes on more than one shelf, or on one the turn did not record, name no single memory', async () => {
      expect(await titleOf([mine, inProject(afterwards)])).toBe('Added to memory')
      expect(await titleOf([inTurn])).toBe('Added to memory')
      expect(await titleOf([mine, inProject({ ...inTurn, supersedes: 'Alt.' })])).toBe('Memory updated')
    })
  })

  describe('every row says who reads it and can be taken back there (ADR-0180)', () => {
    const open = async (view: JSX.Element) => {
      const user = userEvent.setup()
      render(view)
      await user.click(screen.getByTestId('memory-chip'))
      await screen.findByRole('dialog')
      return user
    }
    const rowOf = (content: string): HTMLElement =>
      screen.getAllByTestId('memory-item').find((row) => row.textContent?.includes(content)) as HTMLElement
    const WRITER = { canWrite: true, activeIds: null }
    const VIEWER = { canWrite: false, activeIds: null }

    test('a personal row reads „only you“, links to the reader’s own memory and is theirs to remove', async () => {
      const onRemove = vi.fn()
      const user = await open(<MemoryNotedChipView items={[mine]} projectId={null} onRemove={onRemove} />)

      expect(screen.getByTestId('memory-item-audience')).toHaveTextContent('Only you')
      expect(screen.getByRole('link', { name: 'Manage in My memory' })).toHaveAttribute('href', '/app/memory')
      await user.click(within(rowOf(mine.content)).getByRole('button', { name: `Remove note: ${mine.content}` }))
      expect(onRemove).toHaveBeenCalledWith(mine)
    })

    test('a restricted row names its narrower audience', async () => {
      await open(<MemoryNotedChipView items={[{ ...afterwards, audience: 'restricted' }]} projectId="p-1" />)
      expect(screen.getByTestId('memory-item-audience')).toHaveTextContent('Read by those who may read the folder')
    })

    test('a project note has no remove action for a reader without the right, or before the project answered', async () => {
      const note = saved(afterwards, 'project')
      await open(<MemoryNotedChipView items={[note]} projectId="p-1" shelf={VIEWER} onRemove={vi.fn()} />)
      expect(screen.queryByTestId('memory-item-remove')).not.toBeInTheDocument()
      cleanup()

      await open(<MemoryNotedChipView items={[note]} projectId="p-1" onRemove={vi.fn()} />)
      expect(screen.queryByTestId('memory-item-remove')).not.toBeInTheDocument()
      cleanup()

      await open(<MemoryNotedChipView items={[note]} projectId="p-1" shelf={WRITER} onRemove={vi.fn()} />)
      expect(screen.getByTestId('memory-item-remove')).toBeInTheDocument()
    })

    test('an office note is removable by any member, a project note without a project by nobody', async () => {
      const office = saved(inTurn, 'organization')
      const project = saved(afterwards, 'project')
      await open(<MemoryNotedChipView items={[office, project]} projectId={null} shelf={WRITER} onRemove={vi.fn()} />)

      expect(within(rowOf(office.content)).getByTestId('memory-item-remove')).toBeInTheDocument()
      expect(within(rowOf(project.content)).queryByTestId('memory-item-remove')).not.toBeInTheDocument()
    })

    test('a note that replaced an earlier one is not removable: it links to the memory page instead', async () => {
      const correction = { ...saved(inTurn, 'project'), supersedes: 'Die Fluchtwegbreite ist mit 1,00 m vorgegeben.' }
      await open(<MemoryNotedChipView items={[correction]} projectId="p-1" shelf={WRITER} onRemove={vi.fn()} />)

      const row = rowOf(correction.content)
      expect(within(row).queryByTestId('memory-item-remove')).not.toBeInTheDocument()
      expect(within(row).getByTestId('memory-item-replaced-hint')).toHaveTextContent(
        'Replaced an earlier note, so it cannot be taken back here.'
      )
      expect(within(row).getByRole('link', { name: 'Open memory' })).toHaveAttribute(
        'href',
        '/app/projects/p-1/settings/memory'
      )
    })

    test('a note the turn cannot name (an older card) offers no remove action', async () => {
      await open(<MemoryNotedChipView items={[inProject(inTurn)]} projectId="p-1" shelf={WRITER} onRemove={vi.fn()} />)
      expect(screen.queryByTestId('memory-item-remove')).not.toBeInTheDocument()
    })

    test('shows each step of taking a note back, and the result on the row', async () => {
      const note = saved(afterwards, 'project')
      const view = (removal?: NoteRemoval) => (
        <MemoryNotedChipView
          items={[note]}
          projectId="p-1"
          shelf={WRITER}
          removals={removal ? { [note.id]: removal } : {}}
          onRemove={vi.fn()}
        />
      )
      await open(view('removing'))
      expect(screen.getByTestId('memory-item-remove')).toBeDisabled()
      expect(screen.getByTestId('memory-item-remove')).toHaveTextContent('Removing …')
      cleanup()

      await open(view('failed'))
      expect(screen.getByRole('alert')).toHaveTextContent('Could not be removed.')
      expect(screen.getByTestId('memory-item-remove')).toHaveTextContent('Try again')
      cleanup()

      await open(view('removed'))
      const row = rowOf(note.content)
      expect(within(row).getByRole('status')).toHaveTextContent('Removed. The note is deleted.')
      expect(row.querySelector('del')).toHaveTextContent(note.content)
      expect(within(row).queryByTestId('memory-item-remove')).not.toBeInTheDocument()
      cleanup()

      await open(view('gone'))
      expect(screen.getByTestId('memory-item-gone')).toHaveTextContent('No longer in memory.')
    })

    test('a project note the project no longer holds says so and offers nothing', async () => {
      const note = saved(afterwards, 'project')
      const office = saved(inTurn, 'organization')
      await open(
        <MemoryNotedChipView items={[note, office]} projectId="p-1" shelf={{ canWrite: true, activeIds: [] }} onRemove={vi.fn()} />
      )
      expect(within(rowOf(note.content)).getByTestId('memory-item-gone')).toBeInTheDocument()
      // The project's list says nothing about the office's notes.
      expect(within(rowOf(office.content)).getByTestId('memory-item-remove')).toBeInTheDocument()
    })

    test('speaks German: audience, action and result', async () => {
      const note = saved(afterwards, 'project')
      await open(
        <I18nProvider initialLocale="de" fixedLocale>
          <MemoryNotedChipView
            items={[mine, note, saved(inTurn, 'organization')]}
            projectId="p-1"
            shelf={WRITER}
            removals={{ [note.id]: 'removed' }}
            onRemove={vi.fn()}
          />
        </I18nProvider>
      )
      expect(screen.getAllByTestId('memory-item-audience').map((node) => node.textContent)).toEqual([
        'Nur Sie',
        'Liest das Projektteam',
        'Lesen alle im Büro',
      ])
      expect(screen.getByRole('dialog', { name: 'In das Gedächtnis aufgenommen' })).toBeInTheDocument()
      expect(screen.getAllByTestId('memory-item-remove')[0]).toHaveTextContent('Entfernen')
      expect(screen.getByTestId('memory-item-removed')).toHaveTextContent('Entfernt. Die Notiz ist gelöscht.')
      expect(screen.getByRole('link', { name: 'In „Mein Gedächtnis“ verwalten' })).toBeInTheDocument()
    })
  })

  describe('wired to the open conversation', () => {
    const PROJECT = 'p-1'
    const CONVERSATION = 's-1'
    const note = saved(afterwards, 'project')
    const calls: { method: string; url: string }[] = []
    let canWrite = true
    let deleteStatus = 204

    beforeEach(() => {
      calls.length = 0
      canWrite = true
      deleteStatus = 204
      resetTurnNotes()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          const method = init?.method ?? 'GET'
          calls.push({ method, url })
          if (method === 'DELETE') return new Response(null, { status: deleteStatus })
          return Response.json({ items: [{ id: note.id }], nextCursor: null, canWrite })
        })
      )
    })
    afterEach(() => vi.unstubAllGlobals())

    const openChip = async (items: TurnMemoryItem[]) => {
      const user = userEvent.setup()
      render(<MemoryNotedChip items={items} projectId={PROJECT} conversationId={CONVERSATION} />)
      await user.click(screen.getByTestId('memory-chip'))
      return user
    }

    test('asks the project once, on open, whether this reader may remove its notes, then deletes on the item route', async () => {
      const user = await openChip([note])

      await user.click(await screen.findByTestId('memory-item-remove'))

      expect(await screen.findByTestId('memory-item-removed')).toBeInTheDocument()
      expect(calls).toEqual([
        { method: 'GET', url: `/api/projects/${PROJECT}/memory?conversationId=${CONVERSATION}&limit=200` },
        { method: 'DELETE', url: `/api/projects/${PROJECT}/memory/${note.id}` },
      ])
    })

    test('a reader the project gives no write right sees no remove action', async () => {
      canWrite = false
      await openChip([note])

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(screen.queryByTestId('memory-item-remove')).not.toBeInTheDocument()
    })

    test('a turn with no project note asks the project nothing, and removes on the shelf’s own route', async () => {
      const office = saved(inTurn, 'organization')
      const user = await openChip([mine, office])

      await user.click(within(screen.getAllByTestId('memory-item')[0]).getByTestId('memory-item-remove'))
      await user.click(within(screen.getAllByTestId('memory-item')[1]).getByTestId('memory-item-remove'))

      await waitFor(() => expect(screen.getAllByTestId('memory-item-removed')).toHaveLength(2))
      expect(calls).toEqual([
        { method: 'DELETE', url: `/api/user/memory/${mine.id}` },
        { method: 'DELETE', url: `/api/organization/memory/${office.id}` },
      ])
    })

    test('a note that was already removed elsewhere says so; a refusal can be tried again', async () => {
      deleteStatus = 404
      const user = await openChip([mine])
      await user.click(screen.getByTestId('memory-item-remove'))
      expect(await screen.findByTestId('memory-item-gone')).toBeInTheDocument()
      cleanup()

      resetTurnNotes()
      deleteStatus = 500
      const again = await openChip([mine])
      await again.click(screen.getByTestId('memory-item-remove'))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not be removed.')
      deleteStatus = 204
      await again.click(screen.getByTestId('memory-item-remove'))
      expect(await screen.findByTestId('memory-item-removed')).toBeInTheDocument()
    })
  })
})
