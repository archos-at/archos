import type { JSX } from 'react'
import { Suspense } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { requireMailReviewer } from '@/lib/inbound-mail/access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getProjectUsage } from '@/lib/budgets/service'
import { findProjectIntake } from '@/lib/project-intake/repository'
import { getIntakeView } from '@/lib/project-intake/service'
import { getProjectActivity } from '@/lib/projects/activity'
import { getProjectOverviewData } from '@/lib/projects/overview-query'
import { projectOverviewReader } from '@/lib/projects/service'
import { resolveProjectSettingsAccess } from '@/lib/projects/settings-access'
import { getProjectRecord } from '@/lib/projects/project-record-service'
import { getSimilarProjects } from '@/lib/references/service'
import { BentoCell } from '@/components/ui/bento'
import { Skeleton } from '@/components/ui/skeleton'
import { InboundMailAddressTile } from '@/features/inbound-mail/components/inbound-mail-address'
import { ProjectOverview } from '@/features/projects/components/overview/project-overview'
import { SimilarProjectsTile } from '@/features/projects/components/overview/similar-projects-tile'
import { settingsSectionHref } from '@/features/projects/lib/settings-sections'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('sections.settings') }
}

export default async function ProjectOverviewPage({ params }: PageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    await requireProjectAccess(session, id, 'project:view')

    const [data, access, activity, projectRecord, intake, mailReviewer] = await Promise.all([
      projectOverviewReader(session, id).then((reader) =>
        getProjectOverviewData(id, session.organizationId, reader)
      ),
      resolveProjectSettingsAccess(session, id),
      getProjectActivity(session, id),
      getProjectRecord(session, id),
      findProjectIntake(session.organizationId, id),
      isInboundMailEnabled(session) ? requireMailReviewer(session, id).then(() => true, () => false) : false,
    ])
    if (!data) notFound()

    const usage = access.manageBudget ? await getProjectUsage(session, id) : null
    const setupOpen = intake !== null && intake.status !== 'completed'
    const setupView = setupOpen ? await getIntakeView(session, id).catch(() => null) : null

    return (
      <ProjectOverview
        data={data}
        activity={activity}
        usage={usage}
        projectRecord={projectRecord}
        setupOpen={setupOpen}
        setupProgress={setupView ? { status: setupView.status, counts: setupView.counts } : undefined}
        similar={
          <Suspense
            fallback={
              <BentoCell span="wide">
                <Skeleton className="h-40 rounded-lg" />
              </BentoCell>
            }
          >
            <SimilarProjectsSlot projectId={id} />
          </Suspense>
        }
        inboundMailAddress={mailReviewer ? <InboundMailAddressTile projectId={id} projectName={data.name} /> : undefined}
        access={{
          manage: access.manage,
          changeStatus: access.changeStatus,
          writeMemory: access.writeMemory,
          editProfile: access.editProfile,
          manageMembers: access.manageMembers,
        }}
      />
    )
  })
}

async function SimilarProjectsSlot({ projectId }: { projectId: string }): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const page = await getSimilarProjects(session, projectId)
    return (
      <SimilarProjectsTile
        page={page}
        href={settingsSectionHref(projectId, 'references')}
      />
    )
  })
}
