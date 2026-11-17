'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'
import { cn } from '@/lib/utils'
import { mailThreadClient, type MailThreadClient } from './client'
import { MailOriginLine, useOpenMailOrigin } from './mail-origin-line'

export function newestVersionOrigins(versions: readonly { versionNumber: number; mailOrigins?: MailOriginView[] }[]): MailOriginView[] {
  const newest = versions.reduce<(typeof versions)[number] | null>(
    (best, version) => (best === null || version.versionNumber > best.versionNumber ? version : best),
    null,
  )
  return newest?.mailOrigins ?? []
}

export interface MailProvenanceRowProps {
  projectId: string
  documentId: string
  client?: MailThreadClient
  className?: string
}

export function MailProvenanceRow({ projectId, documentId, client = mailThreadClient, className }: MailProvenanceRowProps): JSX.Element | null {
  const [origins, setOrigins] = useState<MailOriginView[]>([])
  const open = useOpenMailOrigin(projectId, client)

  useEffect(() => {
    let alive = true
    setOrigins([])
    client
      .versions(documentId)
      .then((listing) => {
        if (alive) setOrigins(newestVersionOrigins(listing.versions))
      })
      .catch(() => {
        // Provenance is said when it can be read; a failed read leaves the row out.
      })
    return () => {
      alive = false
    }
  }, [client, documentId])

  if (origins.length === 0) return null
  return (
    <div className={cn('border-b px-3.5 py-2 @md:px-5', className)} data-testid="mail-provenance-row">
      <MailOriginLine origins={origins} onOpen={open} variant="row" />
    </div>
  )
}
