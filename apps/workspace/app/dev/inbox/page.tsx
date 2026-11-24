'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { InboxBadge, InboxBell, InboxWorkspace } from '@/features/collaboration/components'
import { installInboxShim, isEmptyVariant } from '../_fixtures/inbox-items'
import { VIEWER_ID } from '../_fixtures/inbox-rows'
import { SectionLabel } from '@/components/ui/section-label'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'

installInboxShim()

export default function InboxDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [ready, setReady] = useState(false)
  const [empty, setEmpty] = useState(false)
  useEffect(() => {
    setEmpty(isEmptyVariant())
    setReady(true)
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <NormDialogProvider dialog={NormDialog}>
      <main
        data-testid="inbox-preview"
        className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 text-foreground md:px-8"
      >
        <div>
          <h1 className="text-xl font-semibold">Postfach</h1>
          <p className="mt-1 text-sm text-muted-foreground">Anfragen und Neuigkeiten aus Ihrem Team.</p>
        </div>

        {ready && (
          <div className="h-[36rem]">
            <InboxWorkspace viewerId={VIEWER_ID} />
          </div>
        )}

        {!empty && (
          <section className="space-y-3">
            <SectionLabel as="h2">
              Badge
            </SectionLabel>
            <div className="flex flex-wrap items-center gap-6">
              {[1, 4, 128].map((count) => (
                <div key={count} className="flex items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Postfach</span>
                  <InboxBadge pending={count} />
                </div>
              ))}
              <InboxBell />
            </div>
          </section>
        )}
      </main>
      </NormDialogProvider>
    </I18nProvider>
  )
}
