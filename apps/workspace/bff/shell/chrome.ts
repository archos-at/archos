import 'server-only'

import { getUserSession } from '@/lib/auth/session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getNavFlags, type NavFlags } from '@/lib/authz/nav'
import { isIfcModelsEnabled, isInboundMailEnabled, isSkillsEnabled } from '@/lib/authz/feature-flags'
import { listProjects } from '@/lib/projects/service'
import { getOrganizationDisplayName, switchableOrganizations } from '@/lib/organizations/service'
import { ensureOrganizationRow } from '@/lib/organizations/home-country-row'
import type { SwitchableOrganization } from '@/lib/organizations/switchable'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { resolveTourEligibility } from '@/lib/onboarding/tour-eligibility'
import { NO_TOURS, type TourEligibility } from '@/lib/onboarding/product-tour'
import { resolveWhatsNewNotice } from '@/lib/release-notes/summary-notice'
import type { WhatsNewNoticeState } from '@/lib/release-notes/release-notes-wire'
import type { ProjectSwitcherProject } from '@/components/shell/project-switcher'
import type { SidebarUser } from '@/components/shell/sidebar-user-menu'

export interface ShellChrome {
  projects: ProjectSwitcherProject[]
  user?: SidebarUser
  organizationName: string | null
  organizations: SwitchableOrganization[]
  navFlags: NavFlags
  showSkills: boolean
  showModels: boolean
  inboundMail: boolean
  authRequired: boolean
  tours: TourEligibility
  whatsNew: WhatsNewNoticeState | null
}

const EMPTY_NAV_FLAGS: NavFlags = {
  canManageOrganization: false,
  canViewOrganization: false,
  canManagePlatform: false,
  canAccessOfficeShelf: false,
  canAccessOfficeStandards: false,
  canCollaborate: false,
  canAccessInbox: false,
}

function emptyChrome(): ShellChrome {
  return {
    projects: [],
    user: undefined,
    organizationName: null,
    organizations: [],
    navFlags: EMPTY_NAV_FLAGS,
    showSkills: false,
    showModels: false,
    inboundMail: false,
    authRequired: isAuthRequired(),
    tours: NO_TOURS,
    whatsNew: null,
  }
}

export async function resolveShellChrome(): Promise<ShellChrome> {
  let session: Awaited<ReturnType<typeof getUserSession>> = null
  try {
    session = await getUserSession()
  } catch {
    return emptyChrome()
  }
  if (!session) return emptyChrome()

  const authRequired = isAuthRequired()
  const switchable = authRequired
    ? switchableOrganizations(session.organizationId, session.userId)
    : Promise.resolve([])

  let navFlags = EMPTY_NAV_FLAGS
  try {
    navFlags = await getNavFlags(session)
  } catch {
    // page that 500s because a capability lookup was slow or down.
  }

  let projects: ProjectSwitcherProject[] = []
  if (session.organizationId) {
    try {
      projects = (await listProjects(session as AuthorizedSession))
        .map((project) => ({ id: project.id, name: project.name, status: project.status }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      projects = []
    }
  }

  let organizationName: string | null = null
  try {
    if (session.organizationId) void ensureOrganizationRow(session.organizationId)
    organizationName = await getOrganizationDisplayName(session.organizationId)
  } catch {
    organizationName = null
  }

  const tours = session.organizationId ? await resolveTourEligibility(session as AuthorizedSession) : NO_TOURS
  const whatsNew = session.organizationId ? await resolveWhatsNewNotice(session as AuthorizedSession, tours) : null

  return {
    projects,
    user: { name: session.name, email: session.email },
    organizationName,
    organizations: await switchable,
    navFlags,
    showSkills: isSkillsEnabled(session),
    showModels: isIfcModelsEnabled(session),
    inboundMail: isInboundMailEnabled(session),
    authRequired,
    tours,
    whatsNew,
  }
}
