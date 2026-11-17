'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { UploadSummary, UploadSummaryDocument } from '@/adapters/api/upload-batches-client'
import { Chip } from '@/components/ui/chip'
import { ClampedText } from '@/components/ui/clamped-text'
import { Item, ItemContent, ItemDescription, ItemMedia } from '@/components/ui/item'
import { DocumentStatusBadge, fileTypeIcon } from '@/features/documents/components/document-status'
import { IngestFailureNotice } from '@/features/documents/components/ingest-failure-notice'
import { QuarantineFindings } from '@/features/documents/components/quarantine-findings'
import { HeldUploadDecision } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { uploadBatchesCopy } from '@/i18n/namespaces/upload-batches'
import { documentTypeOf, tagLabel } from '@/lib/documents/tag-vocabulary'
import { displayNameOf, otherTags } from '../lib/upload-summary'
import { FacetChip, useTallyLabel } from './upload-atoms'

const SUMMARY_LINES = 2

function HeldFileDecision({ documentId, name, href }: { documentId: string; name: string; href: string | null }): JSX.Element {
  const router = useRouter()
  return (
    <div className="flex flex-wrap gap-1.5">
      <HeldUploadDecision
        documentId={documentId}
        name={name}
        onView={href ? () => router.push(href) : undefined}
        askTestId={`upload-file-request-release-${documentId}`}
        allowTestId={`upload-file-allow-${documentId}`}
      />
    </div>
  )
}

export function UploadedFileRow({
  document,
  href,
  shelf,
}: {
  document: UploadSummaryDocument
  href: string | null
  shelf: UploadSummary['scope']
}): JSX.Element {
  const t = useTranslations(uploadBatchesCopy)
  const tFiles = useTranslations(filesCopy)
  const tallyLabel = useTallyLabel()
  const name = displayNameOf(document)
  const Icon = fileTypeIcon(null, document.filename)
  const type = documentTypeOf(document.tags)
  const tags = otherTags(document.tags)
  const partlyChecked = document.screening === 'partial' || document.quarantine?.checked === 'partial'

  return (
    <Item as="li" className="items-start hover:bg-transparent" data-testid={`upload-file-${document.id}`}>
      <ItemMedia className="text-muted-foreground size-5 pt-0.5">
        <Icon className="size-4" aria-hidden />
      </ItemMedia>
      <ItemContent className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          {href ? (
            <Link
              href={href}
              title={t(shelf === 'office_shelf' ? 'summary.files.openInOfficeShelf' : 'summary.files.openInFiles')}
              className="text-foreground focus-visible:ring-ring/50 min-w-0 line-clamp-2 rounded-sm text-sm font-medium break-words underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none pointer-coarse:-my-3 pointer-coarse:py-3"
            >
              {name}
            </Link>
          ) : (
            <p className="text-foreground line-clamp-2 min-w-0 text-sm font-medium break-words" title={name}>
              {name}
            </p>
          )}
          <DocumentStatusBadge status={document.status} />
        </div>

        {(document.replaced || document.restricted || type || tags.length > 0 || document.pageCount) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {document.replaced && (
              <FacetChip facet="changed" label={tallyLabel('changed')} hint={t('summary.files.changedHint')} />
            )}
            {document.restricted && (
              <FacetChip facet="protected" label={tallyLabel('protected')} hint={t('summary.files.protectedHint')} />
            )}
            {type && (
              <Chip variant="outline" size="sm" title={tFiles('preview.indexed.documentType')}>
                {tagLabel(type, tFiles)}
              </Chip>
            )}
            {tags.length > 0 && (
              <ul className="contents" aria-label={tFiles('preview.tags')}>
                {tags.map((tag) => (
                  <li key={tag} className="contents">
                    <Chip variant="muted" size="sm">
                      {tagLabel(tag, tFiles)}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
            {document.pageCount ? (
              <ItemDescription className="tabular-nums">
                {t('summary.files.pages', { count: document.pageCount })}
              </ItemDescription>
            ) : null}
          </div>
        )}

        {document.summary && (
          <div>
            <ClampedText
              lines={SUMMARY_LINES}
              moreLabel={tFiles('preview.summaryMore')}
              lessLabel={tFiles('preview.summaryLess')}
              className="text-muted-foreground text-sm leading-relaxed"
              testId={`upload-file-summary-${document.id}`}
            >
              {document.summary}
            </ClampedText>
          </div>
        )}

        {document.outcome === 'quarantined' && (
          <div className="flex flex-col gap-1.5" data-testid={`upload-file-quarantine-${document.id}`}>
            <QuarantineFindings
              verdict={document.quarantine ?? null}
              testId={`upload-file-findings-${document.id}`}
            />
            <HeldFileDecision documentId={document.id} name={name} href={href} />
          </div>
        )}

        {document.outcome === 'failed' && (
          <IngestFailureNotice
            errorMessage={document.errorMessage}
            sentenceClassName="text-error"
            testId={`upload-file-failure-${document.id}`}
          />
        )}
        {document.outcome === 'failed' && document.screening === null && (
          <HeldFileDecision documentId={document.id} name={name} href={href} />
        )}

        {partlyChecked && document.outcome !== 'quarantined' && (
          <ItemDescription className="whitespace-normal" data-testid={`upload-file-screening-${document.id}`}>
            {tFiles('screening.partial')}
          </ItemDescription>
        )}
        {document.screening === 'unchecked' && (
          <ItemDescription className="whitespace-normal" data-testid={`upload-file-screening-${document.id}`}>
            {tFiles('screening.unchecked')}
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  )
}
