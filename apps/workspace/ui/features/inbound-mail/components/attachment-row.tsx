'use client'

import type { JSX } from 'react'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Ban,
  Copy,
  FileStack,
  FileText,
  Folder,
  FolderInput,
  Forward,
  Image as ImageIcon,
  Lock,
  ShieldAlert,
  ShieldQuestion,
  SquareCheck,
  Tag,
  Timer,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NewMark } from '@/components/ui/filing-chip'
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
import { ROW_HAIRLINE } from '@/components/ui/row-hairline'
import type { AttachmentCase, AttachmentNote } from '../lib/attachment-case'
import { asksForDecision, targetForPath, type AttachmentDraft, type FolderOption } from '../lib/draft'
import { readSuggestion } from '../lib/suggestion'
import { AttachmentTargetDialog } from './attachment-target-dialog'
import { AttachmentThumbnail } from './attachment-thumbnail'
import { FiledTo } from './filed-to'
import { CheckLine, FactLine, PlaceFact } from './inbound-mail-atoms'
import { filesCopy } from '@/i18n/namespaces/files'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface AttachmentRowProps {
  projectId: string
  entry: AttachmentCase
  draft: AttachmentDraft
  folders: readonly FolderOption[]
  contentUrl: string | null
  missingSuggestion: 'pending' | 'skipped' | 'none'
  focused?: boolean
  folderBelow?: boolean
  onChange: (change: Partial<Omit<AttachmentDraft, 'partId' | 'suggested'>>) => void
  /** Opens the larger viewer; the press that opened it takes the focus back when it closes. */
  onPreview?: (trigger: HTMLElement) => void
}

export function AttachmentRow({
  projectId,
  entry,
  draft,
  folders,
  contentUrl,
  missingSuggestion,
  focused = false,
  folderBelow = false,
  onChange,
  onPreview,
}: AttachmentRowProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const tFiles = useTranslations(filesCopy)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const changeRef = useRef<HTMLButtonElement>(null)
  const { part, status, selectable } = entry
  const name = part.filedAs?.name ?? part.filename ?? draft.name
  const suggestion = useMemo(() => readSuggestion(part.suggestion), [part.suggestion])
  const destinations = useMemo(
    () =>
      folders
        .filter((folder) => folder.writable)
        .map((folder) => ({ folder: { id: folder.id, name: folder.name, parentId: folder.parentId }, label: folder.path.split('/').join(' / ') })),
    [folders]
  )
  const anySuggested = draft.suggested.folder || draft.suggested.documentType || draft.suggested.name

  const folderTarget = draft.folder
  const showTarget = selectable && draft.checked
  const undecided = !draft.checked && asksForDecision(entry)
  const folderMissing = folderTarget === null && draft.revisionOf === null

  return (
    <Item
      as="li"
      className={cn('items-start px-4 [--row-end:16px] [--row-text:96px]', ROW_HAIRLINE)}
      data-cursor={focused || undefined}
      data-testid={`attachment-${part.id}`}
      data-status={status}
      data-checked={draft.checked || undefined}
    >
      <div className="flex h-10 items-center pointer-coarse:h-12">
        <Checkbox
          checked={selectable && draft.checked}
          disabled={!selectable}
          onCheckedChange={(value) => onChange({ checked: value === true })}
          aria-label={t('attachments.file', { name })}
          data-testid="attachment-checkbox"
        />
      </div>
      <AttachmentPicture name={name} contentType={part.contentType} contentUrl={contentUrl} onPreview={onPreview} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <MiddleTruncate text={name} className={cn('min-w-0 text-sm font-medium', !selectable && status !== 'filed' && 'text-muted-foreground')} />
        </div>
        <AttachmentFacts name={name} part={part} contentUrl={contentUrl} onPreview={onPreview} />
        <AttachmentStatusLine projectId={projectId} entry={entry} />
        {status === 'waiting' && entry.notes.map((note) => <AttachmentNoteLine key={note.kind} projectId={projectId} note={note} />)}
        {undecided && (
          <FactLine icon={SquareCheck} tone="warning" testId="attachment-undecided">
            {t('attachments.notes.undecided')}
          </FactLine>
        )}

        {showTarget && (
          <div className="mt-1 flex flex-col gap-1.5" data-testid="attachment-target">
            {anySuggested && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <AgentGlyph size="xs" className="size-4" />
                {t('suggestion.label')}
              </p>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <PlaceFact icon={Folder} label={t('target.folder')} testId="attachment-folder">
                {folderTarget === null ? t('target.noFolder') : folderTarget.path === '' ? t('suggestion.root') : folderTarget.path}
                {folderTarget?.kind === 'new' && <NewMark className="ml-1.5 align-[1px]">{t('suggestion.newFolder')}</NewMark>}
              </PlaceFact>
              {draft.documentType && (
                <PlaceFact icon={Tag} label={t('suggestion.documentType')} testId="attachment-type">
                  {tagLabel(draft.documentType, tFiles)}
                </PlaceFact>
              )}
              {draft.name !== part.filename && (
                <PlaceFact icon={FileText} label={t('target.name')} testId="attachment-name">
                  {draft.name}
                </PlaceFact>
              )}
              {/* One control for where it goes: a missing folder is chosen right away, anything else is changed in one dialog. */}
              {folderMissing && folderBelow ? null : folderMissing ? (
                <Button type="button" size="sm" variant="secondary" className="px-2.5 text-xs" onClick={() => setPickerOpen(true)} data-testid="attachment-folder-choose">
                  <FolderInput className="size-3.5" aria-hidden />
                  {t('target.chooseFolder')}
                </Button>
              ) : (
                <Button ref={changeRef} type="button" size="sm" variant="secondary" className="px-2.5 text-xs" onClick={() => setEditOpen(true)} data-testid="attachment-change">
                  {t('attachments.change')}
                </Button>
              )}
            </div>
            {folderTarget === null && draft.revisionOf === null && !folderBelow && (
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
        folders={folders}
        onApply={(change) => onChange(change)}
        returnFocusRef={changeRef}
      />
    </Item>
  )
}

export function AttachmentPicture({
  name,
  contentType,
  contentUrl,
  onPreview,
}: {
  name: string
  contentType: string
  contentUrl: string | null
  onPreview?: (trigger: HTMLElement) => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <button
      type="button"
      onClick={(event) => onPreview?.(event.currentTarget)}
      disabled={!contentUrl || !onPreview}
      aria-label={t('attachments.preview', { name })}
      tabIndex={-1}
      className="shrink-0 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default"
    >
      <AttachmentThumbnail filename={name} contentType={contentType} url={contentUrl} />
    </button>
  )
}

export function AttachmentFacts({
  name,
  part,
  contentUrl,
  onPreview,
}: {
  name: string
  part: AttachmentCase['part']
  contentUrl: string | null
  onPreview?: (trigger: HTMLElement) => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const extension = fileExtensionLabel(name) || part.contentType.split('/')[1]?.toUpperCase() || ''
  return (
    <p className="text-muted-foreground text-xs tabular-nums">
      {t('attachments.facts', { type: extension, size: formatBytes(part.sizeBytes, locale) })}
      {/* Visible words, not only the 40px picture: a phone has no hover to discover that the picture opens. */}
      {contentUrl && onPreview && (
        <>
          {CLAUSE_JOIN}
          <Button
            type="button"
            variant="inline"
            className="touch-target h-auto p-0 text-xs font-medium"
            onClick={(event) => onPreview(event.currentTarget)}
            aria-label={t('attachments.preview', { name })}
            data-testid="attachment-preview-open"
          >
            {t('attachments.previewShort')}
          </Button>
        </>
      )}
    </p>
  )
}

export function AttachmentNoteLine({ projectId, note }: { projectId: string; note: AttachmentNote }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  switch (note.kind) {
    case 'duplicate':
      return (
        <FactLine icon={Copy} testId="note-duplicate">
          {t('attachments.notes.duplicate', { path: note.folderPath ? `${note.folderPath}/${note.name}` : note.name })}
          {CLAUSE_JOIN}
          <Button asChild variant="inline">
            <Link href={documentFilesHref(projectId, note.documentId)}>{t('attachments.open')}</Link>
          </Button>
        </FactLine>
      )
    case 'revision':
      return (
        <FactLine icon={FileStack} tone={note.verified ? 'default' : 'warning'} testId="note-revision">
          {note.verified
            ? t('attachments.notes.revision', { version: note.nextVersion, name: note.name })
            : t('attachments.notes.revisionUnverified', { version: note.nextVersion, name: note.name })}
        </FactLine>
      )
    case 'revision_hidden':
      return (
        <FactLine icon={FileStack} testId="note-revision-hidden">
          {t('attachments.notes.revisionHidden')}
        </FactLine>
      )
    case 'name_stop':
      return (
        <FactLine icon={AlertTriangle} tone="warning" testId="note-name-stop">
          {t('attachments.notes.nameStop', { terms: note.terms.join('“, „') })}
        </FactLine>
      )
    case 'risk':
      return (
        <FactLine icon={ShieldAlert} tone="warning" testId={`note-${note.flag}`}>
          {t(`attachments.notes.${note.flag}`)}
        </FactLine>
      )
    case 'encrypted':
      return (
        <FactLine icon={Lock} testId="note-encrypted">
          {t('attachments.notes.encrypted')}
        </FactLine>
      )
    case 'forwarded_inner':
      return (
        <FactLine icon={Forward} testId="note-forwarded">
          {t('attachments.notes.forwarded_inner')}
        </FactLine>
      )
    case 'image_in_mail':
      return (
        <FactLine icon={ImageIcon} testId="note-image">
          {t('attachments.notes.image_in_mail')}
        </FactLine>
      )
    case 'last_failure':
      return (
        <FactLine icon={AlertTriangle} tone="danger" testId="note-last-failure">
          {t('attachments.notes.lastFailure', { reason: t(`failures.${note.failure}`) })}
        </FactLine>
      )
  }
}

export function AttachmentStatusLine({ projectId, entry }: { projectId: string; entry: AttachmentCase }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const { part, status } = entry
  switch (status) {
    case 'scan_pending':
      return (
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
