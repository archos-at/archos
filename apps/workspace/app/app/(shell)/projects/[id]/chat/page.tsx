import { type ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { chatRouteElsewhere } from '@/lib/conversations/chat-route'
import { chatArrivalResumes } from '@/lib/conversations/chat-arrival'
import { getUserSession } from '@/lib/auth/session'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findProjectInOrg } from '@/lib/projects/repository'
import { ProjectChatClient } from './project-chat-client'

interface ProjectChatPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session?: string; new?: string }>
}

const ProjectChatPage = async ({ params, searchParams }: ProjectChatPageProps): Promise<ReactNode> => {
  return runWithTenantSlot(async () => {
    const { id } = await params
    const search = await searchParams
    const conversationId = search.session
    if (conversationId) {
      const session = await getUserSession().catch(() => null)
      if (session?.organizationId && session.organizationMembershipId) {
        const elsewhere = await chatRouteElsewhere(session as AuthorizedSession, conversationId, id)
        if (elsewhere) redirect(elsewhere)
      }
    }

    let canCollaborate = false
    let organizationId: string | null = null
    let greetingName: string | null = null
    let canChatInProject = true
    try {
      const session = await getUserSession()
      if (session) {
        organizationId = session.organizationId
        greetingName = session.name
        canCollaborate = isCollaborationEnabled(session)
        if (session.organizationId && session.organizationMembershipId) {
          try {
            await requireProjectAccess(session as AuthorizedSession, id, CHAT_PERMISSIONS)
          } catch {
            canChatInProject = false
          }
        }
      }
    } catch {
      // Fail open: a session-lookup problem must not hide chat affordances.
    }

    let projectName: string | null = null
    try {
      const project = organizationId ? await findProjectInOrg(id, organizationId) : null
      projectName = project?.name ?? null
    } catch {
      // Fail open: the affordances degrade rather than blanking chat.
    }

    return (
      <ProjectChatClient
        projectId={id}
        projectName={projectName}
        canCollaborate={canCollaborate}
        canChatInProject={canChatInProject}
        arrival={{ resumes: await chatArrivalResumes(id, search), greetingName }}
      />
    )
  })
}

export default ProjectChatPage
