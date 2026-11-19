'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { use } from 'react'
import { FilePreviewDialog } from '@/features/documents/components/file-preview-dialog'
import { FilePreviewPane } from '@/features/documents/components/file-preview-pane'
import {
  FIXTURE,
  GENERATED_FIXTURE,
  SEARCH_HIT_FIXTURE,
  isOfficeVariant,
  isPdfVariant,
  officeFixture,
  pdfFixture,
} from './fixtures'
import { TEXT_FIXTURES } from './text-fixtures'
import { MAIL_ATTACHMENT_FILE, MAIL_PROJECT_ID, MAIL_THREAD_FILE } from './mail-fixtures'
import { DRAWING_FIXTURE } from './drawing-fixtures'
import { REVIEW_FIXTURE, REVIEW_PERMISSIONS } from './review-fixtures'
import { ScrollRailIntoView } from './scroll-rail-into-view'
import { SettlingPreview } from './settling-preview'
import './dev-api-stub'

export default function FilePreviewDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const params = use(searchParams)
  const authored = params.authored
  const variant = typeof params.variant === 'string' ? params.variant : undefined
  const textFixture =
    variant === 'markdown' || variant === 'csv' || variant === 'text'
      ? TEXT_FIXTURES[variant]
      : null

  if (variant === 'review') {
    return (
      <main className="bg-muted/40 flex min-h-dvh items-center justify-center">
        <ScrollRailIntoView />
        <div className="bg-popover text-popover-foreground h-[85dvh] w-[min(960px,calc(100%-2rem))] overflow-hidden rounded-2xl border shadow-lg phone:fixed phone:inset-0 phone:h-dvh phone:w-full phone:rounded-none phone:border-0">
          <FilePreviewPane
            file={REVIEW_FIXTURE}
            projectId="proj-demo"
            projectName="Wohnbau Nord — Linz"
            canManage
            canCollaborate
            lifecyclePermissions={REVIEW_PERMISSIONS}
            viewerUserId="u-1"
            onClose={() => {}}
          />
        </div>
      </main>
    )
  }

  if (variant === 'settling') return <SettlingPreview />

  const officeFile = isOfficeVariant(variant)
    ? officeFixture(variant)
    : isPdfVariant(variant)
      ? pdfFixture(variant)
      : variant === 'drawing'
        ? DRAWING_FIXTURE
        : variant === 'search-hit'
          ? SEARCH_HIT_FIXTURE
          : variant === 'mail-thread'
            ? MAIL_THREAD_FILE
            : variant === 'mail-attachment'
              ? MAIL_ATTACHMENT_FILE
              : null

  return (
    <FilePreviewDialog
      file={officeFile ?? textFixture ?? (authored === 'agent' ? GENERATED_FIXTURE : FIXTURE)}
      projectId={variant === 'mail-thread' || variant === 'mail-attachment' ? MAIL_PROJECT_ID : 'proj-demo'}
      projectName="Wohnbau Nord — Linz"
      canManage
      canCollaborate
      onClose={() => {}}
    />
  )
}
