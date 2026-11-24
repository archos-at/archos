'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { ArrowLeft } from 'lucide-react'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'
import { InboxWorkspace } from '@/features/collaboration/components'
import { I18nProvider } from '@/i18n'
import { installInboxShim } from '../_fixtures/inbox-items'
import { VIEWER_ID } from '../_fixtures/inbox-rows'
import { DevRailShell } from '../_fixtures/rail-shell'

installInboxShim()

export default function InboxShellPreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [at, setAt] = useState<string | null>(null)
  useEffect(() => setAt(new URLSearchParams(window.location.search).get('at') ?? 'inbox'), [])
  if (at === null) return <></>
  const onPage = at === 'inbox'
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <NormDialogProvider dialog={NormDialog}>
        <DevRailShell projectId="dev" projectName="Wohnbau Seestadt Baufeld D12" pathname={onPage ? '/app/inbox' : '/app/projects/dev/files'}>
          {onPage ? (
            <div className="listing-container flex h-full min-h-0 w-full flex-col px-6 py-6" data-testid="inbox-shell-page">
              <InboxWorkspace viewerId={VIEWER_ID} title="Postfach" back={<span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm"><ArrowLeft className="size-4" aria-hidden />Fluchtweglänge im Erdgeschoss</span>} />
            </div>
          ) : (
            <p className="text-muted-foreground m-auto text-sm" data-testid="inbox-shell-elsewhere">
              Eine Projektseite
            </p>
          )}
        </DevRailShell>
      </NormDialogProvider>
    </I18nProvider>
  )
}
