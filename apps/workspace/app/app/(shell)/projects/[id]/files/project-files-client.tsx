'use client'

import type { ComponentProps, JSX } from 'react'
import { useState } from 'react'
import { ProjectFileWorkspace } from '@/features/documents/components/project-file-workspace'
import { InboundMailAddressDialog } from '@/features/inbound-mail/components/inbound-mail-address'
import { useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { inboundMailPaths } from '@/lib/inbound-mail/paths'

export interface ProjectFilesClientProps extends Omit<ComponentProps<typeof ProjectFileWorkspace>, 'inboundMail'> {
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
