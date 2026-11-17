'use client'

import type { FC } from 'react'
import { ArrowUpRight, FileWarning } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { formatBytes } from '@/lib/format'
import { documentDisplayName } from '@/lib/documents/display-name'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import { extChipTint, fileExtensionLabel } from '@/features/documents/document-kind'
import { isCitable, isFailedStatus, isHeldStatus, isNeverIndexed } from '@/features/documents/components/document-status'
import { IngestionGlyph } from '@/features/documents/components/ingestion-atoms'
import type { StoredFile } from '@/features/documents/hooks/use-surfaced-documents'
import { PEEK_ACTION_CLASSES } from './CitationPeek'

export const FileReferencePeek: FC<{
  stored: StoredFile
  writtenAs?: string
  onOpen: () => void
}> = ({ stored, writtenAs, onOpen }) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const { file } = stored
  const name = documentDisplayName(file)
  const ext = fileExtensionLabel(file.filename)
  const tint = extChipTint(ext)

  const notIndexed = isNeverIndexed(file)
  const failed = isFailedStatus(file.status)
  const held = isHeldStatus(file.status)

  const facts = [
    ext || null,
    file.fileSize != null ? formatBytes(file.fileSize, locale) : null,
    file.pageCount != null ? t('fileReference.pages', { count: file.pageCount }) : null,
  ].filter((fact): fact is string => Boolean(fact))

  return (
    <div className="flex flex-col gap-2" data-testid="file-reference-peek">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-px rounded px-1.5 py-0.5 text-[0.65rem] font-semibold leading-none pointer-coarse:text-xs"
          style={{ backgroundColor: tint.background, color: tint.color }}
        >
          {ext || '—'}
        </span>
        <SectionLabel className="leading-tight">{t(`fileReference.shelf.${stored.corpus}`)}</SectionLabel>
      </div>

      <div>
        <p className="text-sm font-medium leading-snug text-foreground">{name}</p>
        {/* Only when the answer spelled it differently from the file's own name
            — a rename, or a different case. Printing the filename under a name
            that IS the filename would be the same string twice. */}
        {name !== file.filename && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={file.filename}>
            {file.filename}
          </p>
        )}
        {writtenAs && writtenAs !== file.filename && writtenAs !== name && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t('fileReference.writtenAs', { name: writtenAs })}
          </p>
        )}
      </div>

      {facts.length > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">{facts.join(' · ')}</p>
      )}

      {file.summary && (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{file.summary}</p>
      )}

      {held && (
        <p
          className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
          data-testid="file-reference-held"
        >
          <IngestionGlyph mark="held" className="mt-px text-warning" />
          {t('fileReference.held')}
        </p>
      )}

      {(failed || notIndexed) && (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <FileWarning className="mt-px size-3.5 shrink-0" aria-hidden />
          {failed ? t('fileReference.failed') : t('fileReference.notIndexed')}
        </p>
      )}

      {/* The chip's own click already opens the document; this is the control
          for a reader who reached the panel by keyboard or by pinning it, and
          it does exactly the same thing rather than a lesser version of it —
          including the half of it the label has to carry: opening a document
          the agent can read also points the next question at it, and a document
          it cannot read only opens. The line above has just said which of the
          two this file is, so the button agrees with it rather than restating
          it. */}
      <button data-attr="chat-open"
        type="button"
        onClick={onOpen}
        className={cn(PEEK_ACTION_CLASSES, 'self-start text-primary')}
      >
        {t(isCitable(file) ? 'fileReference.openAsk' : 'fileReference.open')}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
