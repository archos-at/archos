'use client'

import { useRef, type JSX } from 'react'
import { CalendarClock, UserRound } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatDayRange, localCalendarDay } from '@/lib/format'
import { AssignPopover } from '../../assign-popover'
import type { FileAssignee } from '../../../file-types'
import { MetaChip } from './meta-chip'

const day = (value: string, locale: string) => formatDayRange(value, value, locale)

export function ResponsibilityRow({
  documentId,
  assigneeUserId,
  assigneeName,
  dueOn,
  editable,
  canPickAssignee,
  self,
  onAssignee,
  onDueOn,
}: {
  documentId: string
  assigneeUserId: string | null
  assigneeName: string | null
  dueOn: string | null
  editable: boolean
  canPickAssignee: boolean
  self: FileAssignee | null
  onAssignee: (person: FileAssignee | null) => void
  onDueOn: (day: string | null) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const dateRef = useRef<HTMLInputElement | null>(null)
  const overdue = dueOn !== null && dueOn < localCalendarDay()
  if (!editable && !assigneeName && !dueOn) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canPickAssignee && editable ? (
        <AssignPopover
          documentId={documentId}
          assignees={assigneeUserId ? [{ userId: assigneeUserId, name: assigneeName, email: null, profilePictureUrl: null }] : []}
          pickOnly
          access="write"
          self={self}
          onPick={onAssignee}
          onChanged={() => undefined}
          trigger={
            <MetaChip
              icon={UserRound}
              data-testid="thread-assignee"
              set={Boolean(assigneeName)}
              onClear={assigneeName ? () => onAssignee(null) : undefined}
              clearLabel={t('review.unassign')}
            >
              {assigneeName ?? t('review.assign')}
            </MetaChip>
          }
        />
      ) : (
        assigneeName && (
          <MetaChip
            icon={UserRound}
            disabled={!editable}
            set
            onClear={editable ? () => onAssignee(null) : undefined}
            clearLabel={t('review.unassign')}
          >
            {assigneeName}
          </MetaChip>
        )
      )}
      <span className="relative inline-flex">
        <MetaChip
          icon={CalendarClock}
          data-testid="thread-due"
          set={dueOn !== null}
          tone={overdue ? 'urgent' : undefined}
          disabled={!editable}
          onClick={() => dateRef.current?.showPicker?.()}
          onClear={editable && dueOn ? () => onDueOn(null) : undefined}
          clearLabel={t('review.clearDue')}
        >
          {dueOn ? `${t('review.due')} ${day(dueOn, locale)}${overdue ? ` · ${t('review.overdue')}` : ''}` : t('review.setDue')}
        </MetaChip>
        {editable && (
          <input
            ref={dateRef}
            type="date"
            aria-label={t('review.due')}
            value={dueOn ?? ''}
            onChange={(event) => onDueOn(event.target.value || null)}
            className="pointer-events-none absolute inset-0 opacity-0"
            tabIndex={-1}
          />
        )}
      </span>
    </div>
  )
}
