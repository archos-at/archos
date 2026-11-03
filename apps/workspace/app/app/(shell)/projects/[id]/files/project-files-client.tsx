'use client'

/**
 * A project's Dateien with its E-Mail-Eingang: {@link ProjectFileWorkspace}
 * from the documents feature, and the inbound-mail feature's count and
 * address dialog put into it.
 *
 * The two are composed here, in the route, so neither feature imports the
 * other (docs/contributing/module-seams.md): Dateien knows only that a shelf
 * may have a mail entry (`FileShelf['inboundMail']`), and the E-Mail-Eingang
 * reaches Dateien through the documents index.
 */

import type { ComponentProps, JSX } from 'react'
import { useState } from 'react'
import { ProjectFileWorkspace } from '@/features/documents/components/project-file-workspace'
import { InboundMailAddressDialog } from '@/features/inbound-mail/components/inbound-mail-address'
import { useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { inboundMailPaths } from '@/lib/inbound-mail/paths'

export interface ProjectFilesClientProps extends Omit<ComponentProps<typeof ProjectFileWorkspace>, 'inboundMail'> {
  /**
   * Whether this reader may decide the project's held mail (the `inbound-mail`
   * entitlement and `project:documents:write`, ADR-0137), resolved on the
   * server. Shows the E-Mail-Eingang entry, its count and „Per E-Mail senden …“.
   */
  inboundMailEnabled: boolean
}

export function ProjectFilesClient({ inboundMailEnabled, ...workspace }: ProjectFilesClientProps): JSX.Element {
  const { projectId, projectName } = workspace
  const [addressOpen, setAddressOpen] = useState(false)
  const waiting = useInboundMailWaiting(projectId, inboundMailEnabled)

  return (
    <>
      <ProjectFileWorkspace
        {...workspace}
        inboundMail={
          inboundMailEnabled
            ? {
                href: inboundMailPaths(projectId).list({ status: 'waiting', outcome: null }),
                waiting: waiting.count,
                more: waiting.more,
                openAddress: () => setAddressOpen(true),
              }
            : undefined
        }
      />
      {inboundMailEnabled && (
        <InboundMailAddressDialog projectId={projectId} projectName={projectName} open={addressOpen} onOpenChange={setAddressOpen} />
      )}
    </>
  )
}
