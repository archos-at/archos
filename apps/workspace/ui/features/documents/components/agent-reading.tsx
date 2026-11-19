'use client'

import { CLAUSE_JOIN } from '@/lib/format'
import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { DISCIPLINE_TAGS, DOCUMENT_TYPE_TAGS, tagLabel } from '@/lib/documents/tag-vocabulary'
import type { FileItem } from '../file-types'
import { DocumentTagsEditor } from './document-tags-editor'
import { DocumentTopicsEditor } from './document-topics-editor'
import type { PhotoCapture } from '@/lib/documents/photo-capture'
import { MapPin, Pencil } from 'lucide-react'
import type { DocumentLinks } from '@/lib/documents/findings-wire'
import { DocumentDossier } from './document-dossier'

const TYPE_SET = new Set<string>(DOCUMENT_TYPE_TAGS)
const DISCIPLINE_SET = new Set<string>(DISCIPLINE_TAGS)

export function AgentReading({
  file,
  canManage,
  onTagsUpdated,
  projectId,
  dossierLinks,
}: {
  file: FileItem
  canManage: boolean
  onTagsUpdated?: (fileId: string, tags: string[], topics?: string[]) => void
  projectId?: string
  dossierLinks?: DocumentLinks | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [correcting, setCorrecting] = useState(false)
  useEffect(() => setCorrecting(false), [file.id])
  const [saved, setSaved] = useState<string[] | null>(null)
  const incomingKey = (file.tags ?? []).join('\u0000')
  useEffect(() => setSaved(null), [file.id, incomingKey])

  const [savedTopics, setSavedTopics] = useState<string[] | null>(null)
  const incomingTopicsKey = (file.topics ?? []).join('\u0000')
  useEffect(() => setSavedTopics(null), [file.id, incomingTopicsKey])

  const tags = saved ?? file.tags ?? []
  const topics = savedTopics ?? file.topics ?? []
  const types = tags.filter((tag) => TYPE_SET.has(tag))
  const disciplines = tags.filter((tag) => DISCIPLINE_SET.has(tag))
  const facts = readingFacts(file, locale, t)
  const kindRecordedElsewhere = Boolean(file.baseKnowledgeEntryId) && types.length + disciplines.length + topics.length === 0

  return (
    <div className="flex flex-col gap-2.5" data-testid="agent-reading">
      {facts && <p className="text-muted-foreground text-xs">{facts}</p>}
      {file.capture && <CaptureLine capture={file.capture} />}

      {kindRecordedElsewhere ? null : correcting ? (
        <div className="flex flex-col gap-2 rounded-control bg-background p-2.5" data-testid="agent-reading-editor">
          <DocumentTagsEditor
            fileId={file.id}
            initialTags={tags}
            onTagsUpdated={(id, next) => {
              setSaved(next)
              onTagsUpdated?.(id, next)
            }}
          />
          <DocumentTopicsEditor
            fileId={file.id}
            tags={tags}
            initialTopics={topics}
            onSaved={(id, next) => {
              setSavedTopics(next)
              onTagsUpdated?.(id, tags, next)
            }}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">{t('preview.reading.correctionKept')}</p>
          <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setCorrecting(false)}>
            {t('preview.reading.done')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* The label and the type on one line: the type a name (13/20/500 ink, it decides what the document is), its
              label the muted meta before it; the disciplines and the topics in the muted meta under it. Three styles in
              the group (the summary's 14px body, the 13px name, the 12px meta): a 14px medium type under a 12px label
              stood as a heading of its own, louder than the dialog's title. The middot is bound to the word before it,
              so a wrapped line never starts with one. */}
          <p className="text-muted-foreground text-meta">
            {types.length + disciplines.length + topics.length > 0 ? t('preview.reading.classifiedAs') : t('preview.reading.noType')}
            {types.length > 0 && (
              <>
                {' '}
                <span className="text-foreground text-name" data-testid="agent-reading-type">
                  {types.map((tag) => tagLabel(tag, t)).join(CLAUSE_JOIN)}
                </span>
              </>
            )}
          </p>
          {disciplines.length > 0 && <WordRun words={disciplines.map((tag) => tagLabel(tag, t))} className="text-muted-foreground" />}
          {topics.length > 0 && (
            <p className="text-muted-foreground text-xs leading-relaxed" data-testid="agent-reading-topics">
              {t('preview.reading.topics')}:{' '}
              <WordRun words={topics} inline />
            </p>
          )}
          {canManage && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5 self-start"
              onClick={() => setCorrecting(true)}
              data-testid="agent-reading-correct"
            >
              <Pencil className="size-3" aria-hidden />
              {types.length + disciplines.length + topics.length > 0 ? t('preview.reading.correct') : t('preview.reading.assign')}
            </Button>
          )}
        </div>
      )}
      <DocumentDossier file={file} projectId={projectId} links={dossierLinks} />
    </div>
  )
}

function readingFacts(file: FileItem, locale: string, t: ReturnType<typeof useTranslations>): string | null {
  const parts: string[] = []
  if (!file.coverage && typeof file.pageCount === 'number' && file.pageCount > 0) {
    parts.push(t('brief.pages', { count: file.pageCount, formatted: file.pageCount.toLocaleString(locale) }))
  }
  const kinds = file.contentTypes ?? []
  if (kinds.some((content) => content !== 'text')) {
    parts.push(kinds.map((content) => t(`preview.contentTypeNames.${content}`)).join(', '))
  }
  return parts.length > 0 ? parts.join(CLAUSE_JOIN) : null
}

function CaptureLine({ capture }: { capture: PhotoCapture }) {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const when = capture.capturedAt ? formatCapturedAt(capture.capturedAt, locale) : null
  const located = capture.latitude !== undefined && capture.longitude !== undefined
  if (!when && !capture.camera && !located) return null
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-xs" data-testid="agent-reading-capture">
      {when && <span>{t('preview.reading.capturedAt', { when })}</span>}
      {capture.camera && (
        <>
          {when && <span aria-hidden>·</span>}
          <span>{capture.camera}</span>
        </>
      )}
      {located && (
        <>
          {(when || capture.camera) && <span aria-hidden>·</span>}
          <a
            href={`https://www.openstreetmap.org/?mlat=${capture.latitude}&mlon=${capture.longitude}#map=18/${capture.latitude}/${capture.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
          >
            <MapPin className="size-3" aria-hidden />
            {t('preview.reading.location')}
          </a>
        </>
      )}
    </p>
  )
}

function formatCapturedAt(iso: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!match) return iso
  const [, year, month, day, hour, minute] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const dayLabel = date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return `${dayLabel}, ${hour}:${minute}`
}

function WordRun({ words, className, inline = false }: { words: string[]; className?: string; inline?: boolean }): JSX.Element {
  const run = words.map((word, index) => (
    <span key={word}>
      <span>{word}</span>
      {index < words.length - 1 && <span aria-hidden>{'\u00A0· '}</span>}
    </span>
  ))
  return inline ? <>{run}</> : <p className={cn('text-xs leading-relaxed', className)}>{run}</p>
}
