'use client'

/**
 * One attachment of a held mail, as the person decides it: a checkbox, the
 * first look at it, its name and facts, what the reader must know before
 * filing it (DECISION §9, the case table), and where it would go.
 *
 * Where it goes is the agent's suggestion until the person touches it: the
 * filing chip names the folder and opens the folder picker, the Dokumentart
 * and the name sit beside it, and „Ändern“ edits them. Pressing „Ablegen“
 * is the takeover; there is no separate „Vorschlag übernehmen“.
 *
 * A row that cannot be filed says why in words and offers no checkbox it
 * could not honour: a running or failed scan, malware, a type the office does
 * not file. A clean scan is the normal case and is silent: scanning shows only
 * when it is running or found something.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Ban,
  Copy,
  FileStack,
  FolderInput,
  Forward,
  Image as ImageIcon,
  Lock,
  ShieldAlert,
  ShieldQuestion,
  Tag,
  Timer,
  Undo2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FilingChip } from '@/components/ui/filing-chip'
import { Item } from '@/components/ui/item'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { SuggestionReason } from '@/components/ui/suggestion-panel'
import { documentFilesHref, FolderPickerSheet } from '@/features/documents'
import { fileExtensionLabel } from '@/features/documents/document-kind'
import { useLocale, useTranslations } from '@/i18n'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import { CLAUSE_JOIN, formatBytes, formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AttachmentCase, AttachmentNote } from '../lib/attachment-case'
import { targetForPath, type AttachmentDraft, type FolderOption, type FolderTarget } from '../lib/draft'
import { folderLeaf, readSuggestion } from '../lib/suggestion'
import { AttachmentTargetDialog } from './attachment-target-dialog'
import { AttachmentThumbnail } from './attachment-thumbnail'
import { FiledTo } from './filed-to'
import { CheckLine, FactLine } from './inbound-mail-atoms'
import { filesCopy } from '@/i18n/namespaces/files'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface AttachmentRowProps {
  projectId: string
  entry: AttachmentCase
  draft: AttachmentDraft
  folders: readonly FolderOption[]
  /** The part's content route, for the thumbnail; null when it may not be drawn. */
  contentUrl: string | null
  /** Why no suggestion is shown, when there is none. */
  missingSuggestion: 'pending' | 'skipped' | 'none'
  /** The row has the keyboard's attention (Space previews it). */
  focused?: boolean
  /** Shown, never decided: the mail is only its member's to file (`onlySenderReleases`). No checkbox, no target. */
  readOnly?: boolean
  onChange: (change: Partial<Omit<AttachmentDraft, 'partId' | 'suggested'>>) => void
  onPreview?: () => void
}

function folderLabel(target: FolderTarget, rootLabel: string): string {
  return target.path === '' ? rootLabel : target.path
}

export function AttachmentRow({
  projectId,
  entry,
  draft,
  folders,
  contentUrl,
  missingSuggestion,
  focused = false,
  readOnly = false,
  onChange,
  onPreview,
}: AttachmentRowProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const tFiles = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const { part, status, selectable } = entry
  // Filed, the bytes and their name are gone (D6): the document's name is what it is now called.
  const name = part.filedAs?.name ?? part.filename ?? draft.name
  const suggestion = useMemo(() => readSuggestion(part.suggestion), [part.suggestion])
  const destinations = useMemo(
    () =>
      folders
        .filter((folder) => folder.writable)
        .map((folder) => ({ folder: { id: folder.id, name: folder.name, parentId: folder.parentId }, label: folder.path.split('/').join(' / ') })),
    [folders]
  )
  const extension = fileExtensionLabel(name) || part.contentType.split('/')[1]?.toUpperCase() || ''
  const facts = t('attachments.facts', { type: extension, size: formatBytes(part.sizeBytes, locale) })
  const anySuggested = draft.suggested.folder || draft.suggested.documentType || draft.suggested.name

  const noteLine = (note: AttachmentNote): JSX.Element | null => {
    switch (note.kind) {
      case 'duplicate':
        return (
          <FactLine key="duplicate" icon={Copy} testId="note-duplicate">
            {t('attachments.notes.duplicate', { path: note.folderPath ? `${note.folderPath}/${note.name}` : note.name })}
            {CLAUSE_JOIN}
            <Button asChild variant="inline">
              <Link href={documentFilesHref(projectId, note.documentId)}>{t('attachments.open')}</Link>
            </Button>
          </FactLine>
        )
      case 'revision':
        return (
          <FactLine key="revision" icon={FileStack} tone={note.verified ? 'default' : 'warning'} testId="note-revision">
            {note.verified
              ? t('attachments.notes.revision', { version: note.nextVersion, name: note.name })
              : t('attachments.notes.revisionUnverified', { version: note.nextVersion, name: note.name })}
          </FactLine>
        )
      case 'revision_hidden':
        return (
          <FactLine key="revision_hidden" icon={FileStack} testId="note-revision-hidden">
            {t('attachments.notes.revisionHidden')}
          </FactLine>
        )
      case 'name_stop':
        return (
          <FactLine key="name_stop" icon={AlertTriangle} tone="warning" testId="note-name-stop">
            {t('attachments.notes.nameStop', { terms: note.terms.join('“, „') })}
          </FactLine>
        )
      case 'risk':
        return (
          <FactLine key="risk" icon={ShieldAlert} tone="warning" testId={`note-${note.flag}`}>
            {t(`attachments.notes.${note.flag}`)}
          </FactLine>
        )
      case 'encrypted':
        return (
          <FactLine key="encrypted" icon={Lock} testId="note-encrypted">
            {t('attachments.notes.encrypted')}
          </FactLine>
        )
      case 'forwarded_inner':
        return (
          <FactLine key="forwarded_inner" icon={Forward} testId="note-forwarded">
            {t('attachments.notes.forwarded_inner')}
          </FactLine>
        )
      case 'image_in_mail':
        return (
          <FactLine key="image_in_mail" icon={ImageIcon} testId="note-image">
            {t('attachments.notes.image_in_mail')}
          </FactLine>
        )
      case 'last_failure':
        return (
          <FactLine key="last_failure" icon={AlertTriangle} tone="danger" testId="note-last-failure">
            {t('attachments.notes.lastFailure', { reason: t(`failures.${note.failure}`) })}
          </FactLine>
        )
    }
  }

  const statusLine = (): JSX.Element | null => {
    switch (status) {
      case 'scan_pending':
        return (
          // A still glyph: a spinner on every row would be as many loops on one screen (one ambient loop at a time).
          <FactLine icon={Timer} testId="status-scan-pending">
            {t('attachments.status.scan_pending')}
          </FactLine>
        )
      case 'scan_failed':
        return (
          <FactLine icon={ShieldQuestion} tone="warning" testId="status-scan-failed">
            {t('attachments.status.scan_failed')}
          </FactLine>
        )
      case 'scan_infected':
        return (
          <FactLine icon={ShieldAlert} tone="danger" testId="status-scan-infected">
            {t('attachments.status.scan_infected')}
          </FactLine>
        )
      case 'not_offered':
        return (
          <FactLine icon={Ban} testId="status-not-offered">
            {t('attachments.status.not_offered')}
          </FactLine>
        )
      case 'filing':
        return (
          // Still, like the scan: the detail's own „Wird abgelegt …“ line is the one spinner.
          <FactLine icon={Timer} testId="status-filing">
            {t('attachments.status.filing')}
          </FactLine>
        )
      case 'filed':
        return <FiledTo projectId={projectId} part={part} />
      case 'dismissed':
      case 'expired':
        return (
          <FactLine icon={Undo2} testId={`status-${status}`}>
            {t(`attachments.status.${status}`)}
            {part.restorableUntil && `${CLAUSE_JOIN}${t('row.restorableUntil', { date: formatCalendarDate(part.restorableUntil, locale) })}`}
          </FactLine>
        )
      case 'waiting':
        return null
    }
  }

  const folderTarget = draft.folder
  const showTarget = selectable && draft.checked

  return (
    <Item
      as="li"
      className="items-start px-4"
      data-cursor={focused || undefined}
      data-testid={`attachment-${part.id}`}
      data-status={status}
      data-checked={draft.checked || undefined}
    >
      {!readOnly && (
        <div className="flex h-10 items-center pointer-coarse:h-12">
          <Checkbox
            checked={selectable && draft.checked}
            disabled={!selectable}
            onCheckedChange={(value) => onChange({ checked: value === true })}
            aria-label={t('attachments.file', { name })}
            data-testid="attachment-checkbox"
          />
        </div>
      )}
      <button
        type="button"
        onClick={onPreview}
        disabled={!contentUrl || !onPreview}
        aria-label={t('attachments.preview', { name })}
        className="shrink-0 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default"
      >
        <AttachmentThumbnail filename={name} contentType={part.contentType} url={contentUrl} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <MiddleTruncate text={name} className={cn('min-w-0 text-sm font-medium', !selectable && !readOnly && status !== 'filed' && 'text-muted-foreground')} />
        </div>
        {/* A clean scan is the normal case and says nothing: only a running, failed or infected scan has a line (`statusLine`). */}
        <p className="text-muted-foreground text-xs tabular-nums">{facts}</p>
        {statusLine()}
        {status === 'waiting' && entry.notes.map(noteLine)}

        {showTarget && (
          <div className="mt-1 flex flex-col gap-1.5" data-testid="attachment-target">
            {anySuggested && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <AgentGlyph size="xs" className="size-4" />
                {t('suggestion.label')}
              </p>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              {draft.revisionOf === null &&
                (folderTarget ? (
                  <FilingChip
                    suggested={draft.suggested.folder}
                    target={folderTarget.path === '' ? t('suggestion.root') : folderLeaf(folderTarget.path)}
                    newLabel={folderTarget.kind === 'new' ? t('suggestion.newFolder') : undefined}
                    title={folderLabel(folderTarget, t('suggestion.root'))}
                    onClick={() => setPickerOpen(true)}
                    // „Vorschlag von …“ above says whose it is: the chip is the target, white on the panel's grey, the same
                    // white chip as the Dokumentart beside it (two facts, one shape; „Ändern“ the one text press).
                    mark={false}
                    className="bg-background hover:bg-accent"
                    data-testid="attachment-folder"
                  />
                ) : (
                  <Button type="button" size="sm" variant="secondary" className="px-2.5 text-xs" onClick={() => setPickerOpen(true)} data-testid="attachment-folder-choose">
                    <FolderInput className="size-3.5" aria-hidden />
                    {t('target.chooseFolder')}
                  </Button>
                ))}
              {draft.documentType && (
                // Its own glyph, as the folder chip has its folder: „Bescheide“ and „Bescheid“ side by side were two words
                // one letter apart.
                <Badge variant="secondary" className="bg-background gap-1" data-testid="attachment-type">
                  <Tag className="text-muted-foreground size-3" aria-hidden />
                  {tagLabel(draft.documentType, tFiles)}
                </Badge>
              )}
              {draft.name !== part.filename && (
                <span className="text-muted-foreground min-w-0 text-xs [overflow-wrap:anywhere]" data-testid="attachment-name">
                  → {draft.name}
                </span>
              )}
              <Button type="button" size="sm" variant="ghost" className="text-muted-foreground px-2 text-xs" onClick={() => setEditOpen(true)} data-testid="attachment-change">
                {t('attachments.change')}
              </Button>
            </div>
            {folderTarget === null && draft.revisionOf === null && (
              <p className="text-muted-foreground text-xs" data-testid="suggestion-missing">
                {missingSuggestion === 'pending'
                  ? t('suggestion.pending')
                  : missingSuggestion === 'skipped'
                    ? t('suggestion.none')
                    : t('suggestion.noFolder')}
              </p>
            )}
            {draft.suggested.folder && suggestion?.reason && <SuggestionReason>{suggestion.reason}</SuggestionReason>}
            {part.riskFlags.includes('name_stop') && (
              <CheckLine checked={draft.releaseName} onCheckedChange={(releaseName) => onChange({ releaseName })} testId="attachment-release-name">
                {t('attachments.notes.releaseName')}
              </CheckLine>
            )}
            {entry.risk && (
              <CheckLine checked={draft.acknowledgeRisk} onCheckedChange={(acknowledgeRisk) => onChange({ acknowledgeRisk })} testId="attachment-ack-risk">
                {t('attachments.notes.acknowledgeRisk')}
              </CheckLine>
            )}
            {!entry.risk &&
              draft.revisionOf !== null &&
              entry.notes.some((note) => note.kind === 'revision' && !note.verified) && (
                <CheckLine checked={draft.acknowledgeRisk} onCheckedChange={(acknowledgeRisk) => onChange({ acknowledgeRisk })} testId="attachment-ack-revision">
                  {t('attachments.notes.acknowledgeRevision')}
                </CheckLine>
              )}
          </div>
        )}
      </div>

      <FolderPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t('target.folderPickerTitle')}
        destinations={destinations}
        currentFolderId={folderTarget?.kind === 'existing' ? folderTarget.folderId : undefined}
        onPick={(folderId) => {
          setPickerOpen(false)
          const folder = folderId ? folders.find((option) => option.id === folderId) : null
          onChange({ folder: folder ? targetForPath(folder.path, folders, folder.id) : targetForPath('', folders), revisionOf: null })
        }}
      />
      <AttachmentTargetDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        part={part}
        draft={draft}
        onApply={(change) => onChange(change)}
      />
    </Item>
  )
}
