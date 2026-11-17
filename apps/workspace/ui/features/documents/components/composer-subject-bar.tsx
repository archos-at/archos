'use client'

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { FileText, X } from 'lucide-react'
import { AnimatePresence, motion, motionEntrance } from '@/components/motion'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { sourceBase, sourceTint } from '@/lib/ui/source-tint'
import type { ComposerSubject } from '@/features/chat/types'
import { DOCUMENT_VERSION_STATES, type DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { documentFilesHref } from '../lib/document-question'

const SUBJECT_SHELVES = ['project', 'office_shelf', 'session'] as const

interface DocumentSubjectStatus {
  filename?: string
  displayName?: string | null
  scope?: string | null
  openVersion?: { id?: string | null; state?: string | null } | null
}

export interface ResolvedSubjectIdentity {
  title: string | null
  filename: string | null
  shelf?: ComposerSubject['shelf']
  versionId?: string | null
  versionState?: DocumentVersionState | null
}

export function ComposerSubjectBar({
  subject,
  projectId,
  onClear,
  onResolved,
  onShowFile,
}: {
  subject: ComposerSubject | null
  projectId: string | null
  onClear: () => void
  onResolved: (identity: ResolvedSubjectIdentity) => void
  onShowFile?: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)

  const onResolvedRef = useRef(onResolved)
  useEffect(() => {
    onResolvedRef.current = onResolved
  }, [onResolved])

  const attemptedRef = useRef<string | null>(null)
  const resourceId = subject?.resourceId ?? null

  useEffect(() => {
    if (!resourceId) return
    if (attemptedRef.current === resourceId) return
    attemptedRef.current = resourceId
    let cancelled = false
    fetch(`/api/documents/${encodeURIComponent(resourceId)}/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: DocumentSubjectStatus | null) => {
        if (cancelled || !body) return
        const filename = body.filename?.trim() || null
        const title = body.displayName?.trim() || filename
        const shelf = SUBJECT_SHELVES.find((value) => value === body.scope)
        const open = body.openVersion ?? null
        const versionState = DOCUMENT_VERSION_STATES.find((value) => value === open?.state) ?? null
        onResolvedRef.current({
          title,
          filename,
          shelf,
          versionId: open?.id ?? null,
          versionState,
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [resourceId])

  const name = subject?.title?.trim() || t('assignment.thisFile')
  const href = subject && projectId ? documentFilesHref(projectId, subject.resourceId) : null

  return (
    <AnimatePresence initial={false}>
      {subject && (
        <motion.div
          key={subject.resourceId}
          data-testid="composer-subject-bar"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={motionEntrance}
          className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-control border px-2.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
          style={sourceTint('project')}
        >
          <span
            className="bg-card col-start-1 row-start-1 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control border"
            aria-hidden
          >
            <FileText className="size-3.5" style={{ color: sourceBase('project') }} />
          </span>
          <span className="col-start-2 row-start-1 flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs leading-snug">
              <span className="text-muted-foreground">{t('assignment.askingAboutPrefix')}</span>{' '}
              {href ? (
                <Link
                  href={href}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {name}
                </Link>
              ) : (
                <span className="font-medium">{name}</span>
              )}
            </span>
            <span className="text-xs leading-snug opacity-80">{t('assignment.subjectHint')}</span>
          </span>
          {onShowFile && (
            <button data-attr="composer-show-file"
              type="button"
              data-testid="composer-show-file"
              onClick={onShowFile}
              className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:sm:px-3 col-start-2 row-start-2 -ml-1.5 mt-0.5 justify-self-start rounded-control px-1.5 py-1 text-xs font-medium underline-offset-2 hover:underline sm:col-start-3 sm:row-start-1 sm:ml-0 sm:mt-0 sm:font-normal sm:hover:no-underline"
            >
              {t('assignment.showFile')}
            </button>
          )}
          <button data-attr="files-clear"
            type="button"
            onClick={onClear}
            aria-label={t('assignment.subjectClear')}
            className="focus-visible:ring-ring/60 text-muted-foreground hover:text-foreground duration-quick pointer-coarse:inline-flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:p-0 col-start-3 row-start-1 shrink-0 rounded-control p-1 transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 sm:col-start-4"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
