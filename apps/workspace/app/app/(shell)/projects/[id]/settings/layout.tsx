import type { JSX, ReactNode } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveProjectSettingsAccess } from '@/lib/projects/settings-access'
import { ProjectSectionTabs } from '@/components/shell/project-section-frame'
import { ProjectSettingsNav } from '@/features/projects/components/settings/project-settings-nav'
import { visibleSettingsSections } from '@/features/projects/lib/settings-sections'

export default async function ProjectSettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    await requireProjectAccess(session, id, 'project:view')
    const access = await resolveProjectSettingsAccess(session, id)

    return (
      <div className="listing-container flex flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        {/* In the section's header, under its title, where Dateien's places stand (`ProjectSectionTabs`). */}
        <ProjectSectionTabs>
          <ProjectSettingsNav projectId={id} sections={visibleSettingsSections(access)} />
        </ProjectSectionTabs>
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-base ease-entrance min-w-0 motion-reduce:animate-none">
          {children}
        </div>
      </div>
    )
  })
}
