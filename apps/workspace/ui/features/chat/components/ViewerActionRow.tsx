'use client'

import { useId, type FC } from 'react'
import { ArrowUpRight, Box, Columns2, Highlighter, SquareDashed } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import {
  autoPreference,
  setViewerActionsAuto,
  showViewerAction,
  undoViewerAction,
  useViewerActionStore,
  viewerActionsOf,
  type ViewerActionEntry,
  type ViewerActionName,
} from '../lib/viewer-actions'

const ICONS: Record<ViewerActionName, typeof ArrowUpRight> = {
  open_document: ArrowUpRight,
  highlight_passage: Highlighter,
  highlight_region: SquareDashed,
  compare_revisions: Columns2,
  focus_ifc_element: Box,
}

type T = ReturnType<typeof useTranslations>

export const describeViewerAction = (t: T, entry: ViewerActionEntry): string => {
  const { tool_call_name: name, args } = entry.call
  const place = args.page ? t('viewerActions.place', { name: args.document_name, page: args.page }) : args.document_name
  return t(`viewerActions.what.${name}`, {
    place,
    name: args.document_name,
    against: args.against_document_name ?? '',
  })
}

export const viewerActionStatusText = (t: T, entry: ViewerActionEntry): string => {
  switch (entry.status) {
    case 'offered':
      if (entry.reason === 'leaves' && entry.call.tool_call_name === 'focus_ifc_element') return t('viewerActions.offered.model')
      return t(`viewerActions.offered.${entry.reason ?? 'off'}`)
    case 'shown':
      return t(`viewerActions.shown.${entry.where ?? 'beside'}`)
    case 'refused':
      return t(`viewerActions.refused.${entry.refusal ?? 'unavailable'}`)
    case 'held':
      return t('viewerActions.status.held')
    case 'pending':
      return t('viewerActions.status.pending')
    default:
      return t(`viewerActions.status.${entry.status}`)
  }
}

const Row: FC<{ entry: ViewerActionEntry }> = ({ entry }) => {
  const t = useTranslations(chatCopy)
  const Icon = ICONS[entry.call.tool_call_name]
  const what = describeViewerAction(t, entry)
  const id = entry.call.tool_call_id
  return (
    <li className="flex min-w-0 items-start gap-2 text-xs" data-testid="viewer-action" data-status={entry.status}>
      <Icon className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
      {/* Wraps rather than truncates: on a phone the file name and the outcome are the whole message. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 leading-5">
        <span className="font-medium text-foreground [overflow-wrap:anywhere]">{what}</span>
        {/* The one live region: announced as it changes, so the person hears that their viewer moved, and where. */}
        <span className="text-muted-foreground" aria-live="polite" data-testid="viewer-action-status">
          {viewerActionStatusText(t, entry)}
        </span>
      </span>
      {entry.status === 'shown' && !entry.left && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2"
          aria-label={t('viewerActions.undoAria', { what })}
          onClick={() => undoViewerAction(id)}
        >
          {t('viewerActions.undo')}
        </Button>
      )}
      {(entry.status === 'held' || entry.status === 'offered' || entry.status === 'undone') && (
        <Button
          variant="secondary"
          size="sm"
          className="h-6 shrink-0 px-2"
          aria-label={t('viewerActions.showAria', { what })}
          onClick={() => void showViewerAction(id)}
        >
          {t('viewerActions.show')}
        </Button>
      )}
    </li>
  )
}

export const ViewerActionsSwitch: FC<{ className?: string }> = ({ className }) => {
  const t = useTranslations(chatCopy)
  const switchId = useId()
  const auto = useViewerActionStore(autoPreference)
  return (
    <div className={className ?? 'flex items-center gap-2 text-[11px] text-muted-foreground'}>
      <Switch id={switchId} checked={auto} onCheckedChange={setViewerActionsAuto} aria-describedby={`${switchId}-hint`} />
      <label htmlFor={switchId} className="font-medium text-foreground">
        {t('viewerActions.auto')}
      </label>
      <span id={`${switchId}-hint`} className="sr-only">
        {t('viewerActions.autoHint')}
      </span>
    </div>
  )
}

export const ViewerActionRow: FC<{ messageId: string }> = ({ messageId }) => {
  const t = useTranslations(chatCopy)
  const entries = useViewerActionStore(useShallow((state) => viewerActionsOf(state, messageId)))
  const carriesSwitch = useViewerActionStore((state) => state.latestAnswer === messageId)
  if (entries.length === 0) return null
  return (
    <section
      aria-label={t('viewerActions.region')}
      className="flex flex-col gap-1.5 rounded-control bg-info-subtle px-2.5 py-2"
      data-testid="viewer-action-row"
    >
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <Row key={entry.call.tool_call_id} entry={entry} />
        ))}
      </ul>
      {carriesSwitch && <ViewerActionsSwitch />}
    </section>
  )
}
