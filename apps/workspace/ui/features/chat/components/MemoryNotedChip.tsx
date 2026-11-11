'use client'

import { useId, useState, type FC, type JSX } from 'react'
import Link from 'next/link'
import { Brain, BrainCog, Building2, FileText, Lock, Sparkles, Users, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip, ChipCount } from '@/components/ui/chip'
import {
  NoteEmphasis,
  NoteList,
  NoteMeta,
  NotePanelHint,
  NotePanelTitle,
  NoteReplaced,
  NoteRow,
} from '@/components/ui/note-list'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMemoryKindLabels } from '@/components/memory/memory-kinds'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { useChatStore } from '../store'
import {
  loadOfficeShelf,
  loadProjectShelf,
  noteAddress,
  removeNote,
  useOfficeShelf,
  useProjectShelf,
  useTurnNotes,
  type NoteRemoval,
  type ProjectShelfAccess,
} from '../stores/turn-notes-store'
import type { TurnMemoryAudience, TurnMemoryItem } from '../lib/turn-memory'

interface MemoryNotedChipProps {
  /**
   * What was recorded during THIS TURN — derived from the message itself by
   * `turnMemoryItems`, plus the reader's own personal notes saved under it.
   * Computed by the answer that owns the footer because the answer also needs
   * to know whether any exist to decide whether the meta row renders at all.
   *
   * It used to be the whole conversation's memory, polled per rendered answer,
   * so after turn five turn one's answer also read „Piloti hat sich 5 gemerkt".
   */
  items: TurnMemoryItem[]
  /**
   * The project whose memory the turn's project notes are in, and whose memory
   * page the hint links to. Read from the open conversation when not given; a
   * preview or a spec passes it. Without a project the hint stays a sentence
   * and a project note cannot be taken back: there is no route to name it by.
   */
  projectId?: string | null
  /** The conversation the answer is in. Read from the open conversation when not given. */
  conversationId?: string | null
}

export interface MemoryNotedChipViewProps {
  items: TurnMemoryItem[]
  projectId?: string | null
  /** What the project's memory said to this reader; undefined until it was asked. */
  shelf?: ProjectShelfAccess
  /** The office's active notes written from this conversation; undefined until asked, null past one page. */
  officeIds?: readonly string[] | null
  /** Where taking each note back stands, by note id. */
  removals?: Readonly<Record<string, NoteRemoval>>
  onRemove?: (item: TurnMemoryItem) => void
  /** The panel opened or closed: the container asks the project's memory on open. */
  onOpenChange?: (open: boolean) => void
}

/**
 * Who reads a note, by the shelf it went onto (ADR-0180 rule 1): the row's
 * leading glyph, so a padlock means only this reader. The glyphs are the access
 * chip's (`AccessChip`): lock private, people the project's team, building the
 * office. A folder's readers are a part of the team, told apart by the word.
 */
const AUDIENCE_META: Record<TurnMemoryAudience, { icon: LucideIcon; labelKey: string }> = {
  personal: { icon: Lock, labelKey: 'memory.audience.personal' },
  project: { icon: Users, labelKey: 'memory.audience.project' },
  restricted: { icon: Users, labelKey: 'memory.audience.restricted' },
  organization: { icon: Building2, labelKey: 'memory.audience.organization' },
}

/** The memory a note is in, as the panel's title names it; `restricted` is the project's. */
type Shelf = 'personal' | 'project' | 'organization'

const shelfOf = (item: TurnMemoryItem): Shelf | undefined =>
  item.audience === 'restricted' ? 'project' : item.audience

/** The one memory every note of the turn went into, or `mixed` when they differ or one is unknown. */
function titleShelf(items: TurnMemoryItem[]): Shelf | 'mixed' {
  const shelves = new Set(items.map(shelfOf))
  const [only] = shelves
  return shelves.size === 1 && only ? only : 'mixed'
}

/** The page where the notes of a shelf are curated, when there is one to point at. */
function memoryPage(shelf: Shelf | undefined, projectId: string | null | undefined): string | null {
  if (shelf === 'personal') return '/app/memory'
  // The office's notes are curated in a project's memory panel; it has no page of its own.
  return shelf && projectId ? `/app/projects/${encodeURIComponent(projectId)}/settings/memory` : null
}

/** The ids the server listed as this conversation's active notes on the item's shelf; undefined when not asked or unknown. */
function serverListed(
  item: TurnMemoryItem,
  shelf: ProjectShelfAccess | undefined,
  officeIds: readonly string[] | null | undefined
): readonly string[] | null | undefined {
  if (item.audience === 'project' || item.audience === 'restricted') return shelf?.activeIds
  return item.audience === 'organization' ? officeIds : undefined
}

/**
 * Whether this reader may take the note back here. Never a note that replaced
 * an earlier one: removing it would not bring the old note back. A personal
 * note is its owner's, and only the owner is shown one (it comes from their
 * own list, never off the message). A project or office note's id comes off
 * the message's stage frame, which a browser stored, so it is offered only
 * when the shelf's own list of this conversation's notes names it; a project
 * note also needs `project:memory:write`, which that list reports.
 */
function mayRemove(
  item: TurnMemoryItem,
  projectId: string | null | undefined,
  shelf: ProjectShelfAccess | undefined,
  officeIds: readonly string[] | null | undefined
): boolean {
  if (item.supersedes || !item.noteId || !noteAddress(item, projectId)) return false
  if (item.audience === 'personal') return true
  if ((item.audience === 'project' || item.audience === 'restricted') && shelf?.canWrite !== true) return false
  return serverListed(item, shelf, officeIds)?.includes(item.noteId) === true
}

/** A shared note its shelf no longer lists among this conversation's active notes: removed, dismissed or replaced elsewhere. */
const noLongerHeld = (
  item: TurnMemoryItem,
  shelf: ProjectShelfAccess | undefined,
  officeIds: readonly string[] | null | undefined
): boolean => {
  const listed = serverListed(item, shelf, officeIds)
  return Boolean(item.noteId && listed && !listed.includes(item.noteId))
}

const LINK_CLASS = 'text-foreground touch-target font-medium underline underline-offset-2'

/** The line under a note that says what can be done with it, or what was done. */
function NoteOutcome({
  item,
  projectId,
  shelf,
  officeIds,
  removal,
  onRemove,
}: {
  item: TurnMemoryItem
  projectId: string | null | undefined
  shelf: ProjectShelfAccess | undefined
  officeIds: readonly string[] | null | undefined
  removal: NoteRemoval | undefined
  onRemove?: (item: TurnMemoryItem) => void
}): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (removal === 'removed') {
    return (
      <p className="mt-1" role="status" data-testid="memory-item-removed">
        {t('memory.removed')}
      </p>
    )
  }
  if (removal === 'gone' || noLongerHeld(item, shelf, officeIds)) {
    return (
      <p className="mt-1" role="status" data-testid="memory-item-gone">
        {t('memory.gone')}
      </p>
    )
  }
  if (item.supersedes) {
    // Not taken back here: the note it replaced would stay retired.
    const page = memoryPage(shelfOf(item), projectId)
    return (
      <p className="mt-1" data-testid="memory-item-replaced-hint">
        {t('memory.replacedNotRemovable')}{' '}
        {page ? (
          <Link href={page} className={LINK_CLASS} data-testid="memory-item-manage-link">
            {t('memory.openMemory')}
          </Link>
        ) : null}
      </p>
    )
  }
  if (!onRemove || !mayRemove(item, projectId, shelf, officeIds)) return null
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5">
      {removal === 'failed' ? <span role="alert">{t('memory.removeFailed')}</span> : null}
      <Button
        variant="inline"
        className="touch-target"
        disabled={removal === 'removing'}
        aria-busy={removal === 'removing'}
        aria-label={t('memory.removeAria', { note: item.content })}
        data-testid="memory-item-remove"
        onClick={() => onRemove(item)}
      >
        {removal === 'removing' ? t('memory.removing') : removal === 'failed' ? t('memory.removeRetry') : t('memory.remove')}
      </Button>
    </p>
  )
}

/**
 * „Piloti hat sich gemerkt · N" — what this ONE TURN made durable, on the
 * answer's own meta row, never behind the details disclosure: a write to a
 * memory changes what every later answer starts from, and a reader who has to
 * open „Details" to learn that it happened has not been told.
 *
 * The leading agent UIs settled on the same shape (ChatGPT's „Memory updated",
 * Claude's memory indicator): one quiet inline marker on the turn, one tap to
 * see what was written. A banner would outrank the answer it annotates.
 *
 * Two states, by what the turn did:
 * - **added** (Brain, „Piloti hat sich gemerkt"): only new notes.
 * - **updated** (BrainCog, „Gedächtnis aktualisiert"): at least one note
 *   REPLACED an earlier one (`supersedes`). The more important event, because
 *   something the reader may have relied on is gone, so it gets its own label
 *   and glyph, its corrections are listed first, and each one quotes the note
 *   it retired.
 *
 * Every row says who reads the note (ADR-0180: only the reader, the project's
 * team, the office) and can be taken back where it is shown, by a reader who
 * may. The panel's title names the memory the notes went into. The in-turn
 * `remember` writes and the post-answer reflection stage's are labelled apart
 * because they are different promises. Renders nothing until at least one
 * item exists. The chip is `interactive`, so its catchment is 44px
 * (`touch-target`) while the pill stays chip-sized.
 *
 * This is the view: props in, no store and no request. {@link MemoryNotedChip}
 * wires it to the open conversation.
 */
export const MemoryNotedChipView: FC<MemoryNotedChipViewProps> = ({
  items,
  projectId,
  shelf,
  officeIds,
  removals,
  onRemove,
  onOpenChange,
}) => {
  const t = useTranslations(chatCopy)
  const kindLabels = useMemoryKindLabels()
  const titleId = useId()
  const hintId = useId()
  // The reflection stage lands seconds after the answer settled. A chip that
  // arrives in front of the reader fades in (opacity only: it takes its room
  // in a row that is already on screen); one that was there when the answer
  // mounted, a reloaded thread, simply is.
  const [presentAtMount] = useState(items.length > 0)

  if (items.length === 0) return null

  /** In-turn `remember` vs the async reflection stage. */
  const provenanceLabel = (provenance: string): string =>
    provenance === 'distillation'
      ? t('memory.provenance.distillation')
      : t('memory.provenance.inTurn')

  const corrected = items.filter((item) => item.supersedes)
  const updated = corrected.length > 0
  // Corrections first: they are what the reader most needs to check.
  const ordered = updated ? [...corrected, ...items.filter((item) => !item.supersedes)] : items
  const ChipIcon = updated ? BrainCog : Brain
  const where = titleShelf(items)
  const projectPage = items.some((item) => shelfOf(item) !== 'personal') ? memoryPage('project', projectId) : null
  const personalPage = items.some((item) => shelfOf(item) === 'personal') ? memoryPage('personal', projectId) : null

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Chip
          asChild
          variant="info"
          size="sm"
          interactive
          className={cn(!presentAtMount && 'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none')}
          data-testid="memory-chip"
          data-state-kind={updated ? 'updated' : 'added'}
          aria-label={
            updated
              ? t('memory.updatedAria', { count: items.length, corrected: corrected.length })
              : t('memory.notedAria', { count: items.length })
          }
        >
          <button type="button">
            <ChipIcon aria-hidden="true" />
            {updated ? t('memory.updated') : t('memory.noted')}
            <ChipCount count={items.length} />
          </button>
        </Chip>
      </PopoverTrigger>
      {/* Radix gives the panel the dialog role; it is named by its title line. */}
      <PopoverContent
        align="start"
        collisionPadding={12}
        // Bounded by the room on screen: the title and the links stay put and the
        // notes between them scroll, so the last row is never cut off below the fold.
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-24px)] flex-col p-0"
        aria-labelledby={titleId}
        aria-describedby={hintId}
      >
        <NotePanelTitle icon={ChipIcon} id={titleId}>
          {/* A personal note is never a correction, so `updated` has no personal title. */}
          {updated && where !== 'personal' ? t(`memory.updatedIn.${where}`) : t(`memory.addedTo.${where}`)}
        </NotePanelTitle>
        <NoteList className="max-h-none min-h-0 flex-1">
          {ordered.map((item) => {
            const label = kindLabels.kind(item.kind)
            const audience = item.audience ? AUDIENCE_META[item.audience] : null
            const removal = item.noteId ? removals?.[item.noteId] : undefined
            return (
              <NoteRow
                key={item.id}
                icon={audience?.icon ?? FileText}
                data-testid="memory-item"
                data-removal={removal}
                meta={
                  <>
                    <NoteMeta
                      parts={[
                        ...(item.supersedes ? [<NoteEmphasis key="corrected">{t('memory.correctedLabel')}</NoteEmphasis>] : []),
                        label,
                        <>
                          {item.provenance === 'distillation' && <Sparkles className="size-3" aria-hidden="true" />}
                          {provenanceLabel(item.provenance)}
                        </>,
                        ...(audience
                          ? [
                              <span key="audience" data-testid="memory-item-audience">
                                {t(audience.labelKey)}
                              </span>,
                            ]
                          : []),
                      ]}
                    />
                    {item.supersedes ? (
                      <NoteReplaced label={t('memory.replaced')} data-testid="memory-item-supersedes">
                        {item.supersedes}
                      </NoteReplaced>
                    ) : null}
                    <NoteOutcome
                      item={item}
                      projectId={projectId}
                      shelf={shelf}
                      officeIds={officeIds}
                      removal={removal}
                      onRemove={onRemove}
                    />
                  </>
                }
              >
                {/* Struck through and said in words below: the strike is never the only signal. */}
                {removal === 'removed' ? <del>{item.content}</del> : item.content}
              </NoteRow>
            )
          })}
        </NoteList>
        <NotePanelHint id={hintId}>
          {projectPage ? (
            <Link href={projectPage} className={LINK_CLASS} data-testid="memory-manage-link">
              {t('memory.manageLink')}
            </Link>
          ) : null}
          {projectPage && personalPage ? ' · ' : null}
          {personalPage ? (
            <Link href={personalPage} className={LINK_CLASS} data-testid="memory-manage-personal-link">
              {t('memory.manageLinkPersonal')}
            </Link>
          ) : null}
          {projectPage || personalPage ? null : t('memory.manageHint')}
        </NotePanelHint>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The chip on an answer of the open conversation: the view, given what the
 * project's memory says to this reader (asked when the panel opens, and only
 * when the turn wrote a project note) and what was taken back in this tab.
 */
export const MemoryNotedChip: FC<MemoryNotedChipProps> = ({ items, projectId, conversationId }) => {
  const openProjectId = useChatStore((state) => state.currentConversation?.projectId ?? state.projectId ?? null)
  const openConversationId = useChatStore((state) => state.currentConversation?.id ?? null)
  const memoryProjectId = projectId === undefined ? openProjectId : projectId
  const memoryConversationId = conversationId === undefined ? openConversationId : conversationId
  const shelf = useProjectShelf(memoryProjectId, memoryConversationId)
  const officeIds = useOfficeShelf(memoryConversationId)
  const removals = useTurnNotes((state) => state.removals)
  const hasProjectNote = items.some((item) => item.audience === 'project' || item.audience === 'restricted')
  const hasOfficeNote = items.some((item) => item.audience === 'organization')

  return (
    <MemoryNotedChipView
      items={items}
      projectId={memoryProjectId}
      shelf={shelf}
      officeIds={officeIds}
      removals={removals}
      onRemove={(item) => void removeNote(item, memoryProjectId)}
      onOpenChange={(open) => {
        if (open && hasProjectNote && memoryProjectId && memoryConversationId) {
          void loadProjectShelf(memoryProjectId, memoryConversationId)
        }
        if (open && hasOfficeNote && memoryConversationId) void loadOfficeShelf(memoryConversationId)
      }}
    />
  )
}
