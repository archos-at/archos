import { forwardRef, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Item, ItemMedia } from '@/components/ui/item'
import { motion, motionQuick } from '@/components/motion'
import { cn } from '@/lib/utils'
import { formatAbsoluteTime, formatRelativeTime, formatTimeOfDay } from '@/lib/format'
import { useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import { statusKeyFor } from '../../lib/session-status-key'
import type { Session } from '../../types'
import { SessionTemporaryMark, TEMPORARY_LABEL } from '../session-temporary-mark'
import { SessionStatusIcon } from './session-status-icon'

interface SessionItemProps {
  session: Session
  isSelected: boolean
  isBusy?: boolean
  isSessionActive?: boolean
  showRelativeTime?: boolean
  onSelect?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onRename?: (sessionId: string, newTitle: string) => void
}

export const SessionItem = forwardRef<HTMLLIElement, SessionItemProps>(function SessionItem(
  {
    session,
    isSelected,
    isBusy = false,
    isSessionActive = false,
    showRelativeTime = false,
    onSelect,
    onDelete,
    onRename,
  },
  ref
) {
  const t = useTranslations(researchCopy)
  const { locale } = useLocale()
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const tCollab = useTranslations(collaborationCopy)
  const displayTitle = session.contentLocked
    ? tCollab('rightsLost.neutralTitle')
    : session.title.trim() || t('sessionsPanel.untitledSession')

  const sessionDate = session.date instanceof Date ? session.date : new Date(session.date)
  const sessionIso = Number.isNaN(sessionDate.getTime()) ? '' : sessionDate.toISOString()
  const showResearchChip = session.hasActiveDeepResearch || session.hasCompletedReport

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleClick = useCallback(() => {
    if (!isEditing && !isBusy) {
      onSelect?.(session.id)
    }
  }, [isEditing, isBusy, onSelect, session.id])

  const startRename = useCallback(() => {
    setEditValue(session.title)
    setIsEditing(true)
  }, [session.title])

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      startRename()
    },
    [startRename]
  )

  const renameFromMenuRef = useRef(false)
  const handleMenuCloseAutoFocus = useCallback((e: Event) => {
    if (!renameFromMenuRef.current) return
    renameFromMenuRef.current = false
    e.preventDefault()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete?.(session.id)
    },
    [onDelete, session.id]
  )

  const handleSaveRename = useCallback(() => {
    const trimmedValue = editValue.trim()
    if (!trimmedValue) {
      setEditValue(session.title)
      setIsEditing(false)
      return
    }
    if (trimmedValue !== session.title) {
      onRename?.(session.id, trimmedValue)
    }
    setIsEditing(false)
  }, [editValue, session.id, session.title, onRename])

  const handleCancelRename = useCallback(() => {
    setEditValue(session.title)
    setIsEditing(false)
  }, [session.title])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelRename()
      }
    },
    [handleSaveRename, handleCancelRename]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
  }, [])

  const showActions = (isHovered || isFocused) && !isEditing

  const statusKey = statusKeyFor(session, isSessionActive)
  const stateLabel = isBusy
    ? t('sessionsPanel.sessionLabelBusy', { title: displayTitle })
    : statusKey
      ? t('sessionsPanel.sessionLabelWithStatus', { title: displayTitle, status: t(statusKey) })
      : t('sessionsPanel.sessionLabel', { title: displayTitle })
  const rowLabel = session.temporary ? t(TEMPORARY_LABEL, { label: stateLabel }) : stateLabel

  return (
    <Item
      asChild
      className={cn(
        'relative min-h-11 gap-3',
        showResearchChip ? 'items-start' : 'items-center',
        isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        isSelected
          ? 'bg-selected ring-border ring-1 ring-inset hover:bg-selected'
          : 'hover:bg-hover focus-within:bg-hover'
      )}
    >
      <motion.li
        ref={ref}
        layout
        exit={{ opacity: 0, x: 12 }}
        transition={motionQuick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsFocused(false)
          }
        }}
      >
        {isEditing ? (
          <div className="flex min-h-8 w-full items-center">
            <Input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveRename}
              className="h-8 min-w-0 flex-1 px-2.5 pointer-coarse:h-11"
              aria-label={t('sessionsPanel.editTitle')}
            />
          </div>
        ) : (
          <>
            {/* Decorative — the button's label already carries this state in
                words (see `statusKeyFor`). Sibling of the button: a <div> may
                not live inside one, and the stretched overlay keeps the disc
                clickable anyway. */}
            <ItemMedia
              aria-hidden
              className={cn(
                'border-border bg-card rounded-full border',
                showResearchChip && 'mt-0.5'
              )}
            >
              <SessionStatusIcon session={session} isSessionActive={isSessionActive} />
            </ItemMedia>

            <button
              type="button"
              onClick={handleClick}
              disabled={isBusy}
              aria-current={isSelected ? 'true' : undefined}
              aria-label={rowLabel}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-control text-left outline-none pointer-coarse:mr-9 after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              {/* Two-line content block: title + persistent time on line 1, the
                  calm Deep Research badge on line 2. */}
              <span className="flex min-w-0 items-center gap-2">
                {/* Two lines on a phone: a chat is found by its name, and "Rettungswege
                    Bürogeb…" names nothing. One truncated line on a pointer device. */}
                <span
                  className="min-w-0 flex-1 text-sm max-sm:line-clamp-2 max-sm:break-words sm:truncate"
                  title={displayTitle}
                >
                  {displayTitle}
                </span>
                {session.temporary && <SessionTemporaryMark />}
                {sessionIso && (
                  <span
                    className="text-muted-foreground shrink-0 text-xs tabular-nums"
                    title={formatAbsoluteTime(sessionIso, locale)}
                  >
                    {showRelativeTime
                      ? formatRelativeTime(sessionIso, locale)
                      : formatTimeOfDay(sessionIso, locale)}
                  </span>
                )}
              </span>

              {/* FB-10: a calm "Deep Research" badge marks sessions that carry a
                  research run. It lives on its own line so it never swaps with
                  the trailing actions. */}
              {showResearchChip && (
                <Badge variant="secondary" className="mt-0.5">
                  {t('sessionsPanel.deepResearchChip')}
                </Badge>
              )}
            </button>
          </>
        )}

        {/* Touch has no hover, so rename and delete get a second way in: one
            visible 44px menu at the row's trailing edge, present only on a
            coarse pointer (the hover overlay below is the pointer's way). The
            row's title keeps its full width minus that one door. */}
        {!isEditing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute inset-y-0 right-0 z-10 my-auto hidden size-11 pointer-coarse:inline-flex"
                aria-label={t('sessionsPanel.rowActions', { title: displayTitle })}
                data-testid="session-row-menu"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            {/* To the left of the door, over the row it belongs to: dropped below it, the
                menu covered the next row's timestamp. */}
            <DropdownMenuContent
              side="left"
              align="center"
              onCloseAutoFocus={handleMenuCloseAutoFocus}
            >
              {!session.contentLocked && (
                <DropdownMenuItem
                  disabled={isBusy || isSessionActive}
                  onSelect={() => {
                    renameFromMenuRef.current = true
                    startRename()
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  {isBusy || isSessionActive
                    ? t('sessionsPanel.cannotRenameBusy')
                    : t('sessionsPanel.rename')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                disabled={isBusy || isSessionActive}
                onSelect={() => onDelete?.(session.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {isBusy || isSessionActive
                  ? t('sessionsPanel.cannotDeleteBusy')
                  : t('sessionsPanel.deleteSession')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* The actions OVERLAY the row on hover/focus instead of holding a
            permanent column that taxes every title's width. Overlaying is
            reflow-free (the row never resizes) and the resting row spends its
            full width on the title. The action block is a solid fill in the
            colour of the surface the row is actually on, so a long title
            slides under it instead of colliding: the selected grey on the
            selected row, else the sheet with the pointer's wash over it (two
            layers: the wash alone lets the title through). No gradient. */}
        {showActions && (
          <div className={cn('absolute inset-y-0 right-2 z-10 pointer-coarse:hidden animate-in fade-in-0 duration-snap ease-out motion-reduce:animate-none', isSelected ? 'bg-selected' : 'bg-card')}>
            <div className={cn('flex h-full items-center gap-1 pl-6', !isSelected && 'bg-hover')}>
              {!session.contentLocked && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleEditClick}
                  disabled={isBusy || isSessionActive}
                  aria-label={
                    isBusy || isSessionActive
                      ? t('sessionsPanel.renameDisabled')
                      : t('sessionsPanel.rename')
                  }
                  title={
                    isBusy || isSessionActive
                      ? t('sessionsPanel.cannotRenameBusy')
                      : t('sessionsPanel.rename')
                  }
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive size-7"
                onClick={handleDeleteClick}
                disabled={isBusy || isSessionActive}
                aria-label={
                  isBusy || isSessionActive
                    ? t('sessionsPanel.deleteDisabled')
                    : t('sessionsPanel.deleteSession')
                }
                title={
                  isBusy || isSessionActive
                    ? t('sessionsPanel.cannotDeleteBusy')
                    : t('sessionsPanel.deleteSession')
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </motion.li>
    </Item>
  )
})
