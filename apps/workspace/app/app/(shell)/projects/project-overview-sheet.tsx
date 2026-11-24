import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canManageCompliance } from '@/lib/authz/organizations'
import { getProjectsListData } from '@/lib/projects/service'
import { ProjectOverview } from '@/components/projects/project-overview'
import { PageSheetClose } from '@/components/ui/page-sheet'
import { RoutePageSheet } from '@/components/shell/route-page-sheet'
import { RecentlyDeleted } from '@/features/projects/components/recently-deleted'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'
import { projectsCopy } from '@/i18n/namespaces/projects'

export async function ProjectOverviewSheet({
  standalone,
  autoOpenCreate = false,
}: {
  standalone: boolean
  autoOpenCreate?: boolean
}): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(projectsCopy)
    const tCommon = await getTranslations(commonCopy)
    const { projects, viewerActivity } = await getProjectsListData(session, 'newest')
    return (
      <RoutePageSheet
        title={t('portfolio.title')}
        closeLabel={tCommon('actions.close')}
        headerless
        standalone={standalone}
        size="window"
        bodyClassName="flex flex-col overflow-hidden"
      >
        <ProjectOverview
          projects={projects}
          viewerActivity={viewerActivity}
          autoOpenCreate={autoOpenCreate}
          closeAction={<PageSheetClose label={tCommon('actions.close')} />}
          after={<RecentlyDeleted canManageCompliance={canManageCompliance(session)} />}
        />
      </RoutePageSheet>
    )
  })
}
