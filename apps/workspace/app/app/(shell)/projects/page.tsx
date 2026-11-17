import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { getNavFlags } from '@/lib/authz/nav'
import { canManageCompliance } from '@/lib/authz/organizations'
import { getProjectsListData } from '@/lib/projects/service'
import { ProjectsGrid } from '@/components/projects/projects-grid'
import { OfficeShelfEntryCard } from '@/components/projects/office-shelf-entry-card'
import { ShellContent } from '@/components/shell'
import { RecentlyDeleted } from '@/features/projects/components/recently-deleted'
import { getTranslations } from '@/i18n/server'
import { projectsCopy } from '@/i18n/namespaces/projects'

interface ProjectsPageProps {
  searchParams: Promise<{ new?: string }>
}

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const navFlags = await getNavFlags(session)
    const { new: newParam } = await searchParams
    const t = await getTranslations(projectsCopy)

    const {
      projects: rows,
      documentCounts: docCountByProject,
      viewerActivity,
      mailWaiting,
    } = await getProjectsListData(session, 'newest')

    const autoOpenCreate = newParam === '1'

    return (
      <ShellContent width="wide">
        <ProjectsGrid
          projects={rows}
          docCounts={docCountByProject}
          viewerActivity={viewerActivity}
          mailWaiting={mailWaiting}
          autoOpenCreate={autoOpenCreate}
        />

        {/* Org-wide Archiv entry — every member of an organization reaches it
            (`canAccessOfficeShelf`, ADR-0024). */}
        {navFlags.canAccessOfficeShelf && (
          <section className="mt-6" aria-label={t('officeShelfCard.title')}>
            <OfficeShelfEntryCard />
          </section>
        )}

        <RecentlyDeleted canManageCompliance={canManageCompliance(session)} />
      </ShellContent>
    )
  })
}
