import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { findProjectInOrg } from '@/lib/projects/repository'
import { projectRootAccess } from '@/lib/projects/folder-service'
import { NavigationTrailLabel, ProjectSectionFrame } from '@/components/shell'
import { PRODUCT_NAME } from '@/lib/brand'
import { FilePreviewBridge } from '@/features/documents/components/file-preview-host'
import { ProjectFileDrop } from '@/features/documents/components/project-file-drop'
import { CurrentProjectProvider } from '@/features/projects/lib/current-project'
import { ProjectStatusBanner } from '@/features/projects/components/project-status-banner'
import { lifecycleViewOf } from '@/lib/projects/project-status'
import { holdsManageEvenWhenClosed } from '@/lib/projects/settings-access'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { requireMailReviewer } from '@/lib/inbound-mail/access'

interface ProjectLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  try {
    return await withPageSession(async (session) => {
      const { id } = await params
      await requireProjectAccess(session, id, 'project:view')
      const project = await findProjectInOrg(id, session.organizationId)

      if (!project?.name) return {}

      return {
        title: {
          default: `${project.name} — ${PRODUCT_NAME}`,
          template: `${project.name} · %s — ${PRODUCT_NAME}`,
        },
      }
    })
  } catch {
    return {}
  }
}

export default async function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    const access = await requireProjectAccess(session, id, 'project:view')

    const [current, rootAccess, inboundMail] = await Promise.all([
      findProjectInOrg(id, session.organizationId),
      projectRootAccess(session, id).catch((error: unknown): 'read' => {
        console.error('[projects] could not ask the root access for the project drop:', error)
        return 'read'
      }),
      isInboundMailEnabled(session) ? requireMailReviewer(session, id).then(() => true, () => false) : Promise.resolve(false),
    ])
    if (!current) notFound()
    const canChangeStatus =
      current.status !== 'active' &&
      (await holdsManageEvenWhenClosed(session, id).catch((error: unknown) => {
        console.error('[projects] could not ask project:manage for the status banner:', error)
        return false
      }))

    return (
      <>
        {/* Names this project in the tab's return trail, so a surface above
            projects (the Archiv, the Organisation, the Postfach) can offer
            "Zurück zu <project>" rather than a path it can only read an id out
            of — including the org-scope rail's own back control. */}
        <NavigationTrailLabel label={current.name} />
        {/* Which project, and where it stands (ADR-0090, ADR-0098), for every
            surface below: the banner, file previews, chat source chips. */}
        <CurrentProjectProvider
          value={{
            id,
            name: current.name,
            status: current.status,
            closedAt: current.closedAt?.toISOString() ?? null,
            readsBecauseClosed: access.readsBecauseClosed,
            lifecycle: lifecycleViewOf(current),
            canChangeStatus,
          }}
        >
          <ProjectStatusBanner />
          <FilePreviewBridge>
            {/* A file dropped on any page of the project lands in its Dateien;
                a closed project takes none, and a reader who may only read at
                its root is told so. */}
            <ProjectFileDrop projectId={id} disabled={current.status === 'closed'} rootAccess={rootAccess}>
              <ProjectSectionFrame projectId={id} projectName={current.name} inboundMail={inboundMail}>
                {children}
              </ProjectSectionFrame>
            </ProjectFileDrop>
          </FilePreviewBridge>
        </CurrentProjectProvider>
      </>
    )
  })
}
