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
  items: TurnMemoryItem[]
  projectId?: string | null
  conversationId?: string | null
}

export interface MemoryNotedChipViewProps {
  items: TurnMemoryItem[]
  projectId?: string | null
  shelf?: ProjectShelfAccess
  officeIds?: readonly string[] | null
  removals?: Readonly<Record<string, NoteRemoval>>
  onRemove?: (item: TurnMemoryItem) => void
  onOpenChange?: (open: boolean) => void
}

const AUDIENCE_META: Record<TurnMemoryAudience, { icon: LucideIcon; labelKey: string }> = {
  personal: { icon: Lock, labelKey: 'memory.audience.personal' },
  project: { icon: Users, labelKey: 'memory.audience.project' },
  restricted: { icon: Users, labelKey: 'memory.audience.restricted' },
  organization: { icon: Building2, labelKey: 'memory.audience.organization' },
}

type Shelf = 'personal' | 'project' | 'organization'

const shelfOf = (item: TurnMemoryItem): Shelf | undefined =>
  item.audience === 'restricted' ? 'project' : item.audience

function titleShelf(items: TurnMemoryItem[]): Shelf | 'mixed' {
  const shelves = new Set(items.map(shelfOf))
  const [only] = shelves
  return shelves.size === 1 && only ? only : 'mixed'
}

function memoryPage(shelf: Shelf | undefined, projectId: string | null | undefined): string | null {
  if (shelf === 'personal') return '/app/memory'
  return shelf && projectId ? `/app/projects/${encodeURIComponent(projectId)}/settings/memory` : null
}

function serverListed(
  item: TurnMemoryItem,
  shelf: ProjectShelfAccess | undefined,
  officeIds: readonly string[] | null | undefined
): readonly string[] | null | undefined {
  if (item.audience === 'project' || item.audience === 'restricted') return shelf?.activeIds
  return item.audience === 'organization' ? officeIds : undefined
}

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

const noLongerHeld = (
  item: TurnMemoryItem,
  shelf: ProjectShelfAccess | undefined,
  officeIds: readonly string[] | null | undefined
): boolean => {
  const listed = serverListed(item, shelf, officeIds)
  return Boolean(item.noteId && listed && !listed.includes(item.noteId))
}

const LINK_CLASS = 'text-foreground touch-target font-medium underline underline-offset-2'

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
  const [presentAtMount] = useState(items.length > 0)

  if (items.length === 0) return null

  const provenanceLabel = (provenance: string): string =>
    provenance === 'distillation'
      ? t('memory.provenance.distillation')
      : t('memory.provenance.inTurn')

  const corrected = items.filter((item) => item.supersedes)
  const updated = corrected.length > 0
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
