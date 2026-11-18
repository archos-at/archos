import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import {
  canManageMembers,
  canManageModels,
  canViewAuditLogs,
  canViewDownloadLog,
  isOrgAdmin,
} from '@/lib/authz/organizations'
import { BackLink, ShellContent } from '@/components/shell'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import {
  OrganizationNav,
  type OrganizationSectionKey,
} from '@/features/organization/components/organization-nav'

export default async function OrganizationLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    const sections: OrganizationSectionKey[] = ['overview', 'budgets', 'storage', 'screening', 'quarantine']
    if (canManageMembers(session)) sections.push('access')
    if (canManageModels(session)) sections.push('models')
    if (canViewAuditLogs(session)) sections.push('compliance')
    if (canViewDownloadLog(session)) sections.push('downloads')
    if (isOrgAdmin(session)) sections.push('enterprise')

    return (
      <ShellContent>
        <BackLink
          className="touch-target mb-6"
          fallbackHref="/app/projects"
          fallbackLabel={t('backToApp')}
        />
        {/* Rail beside the content from `lg`; stacked strip below that. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <div className="lg:w-52 lg:shrink-0">
            <OrganizationNav sections={sections} />
          </div>
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 min-w-0 flex-1 duration-base ease-entrance motion-reduce:animate-none">
            {children}
          </div>
        </div>
      </ShellContent>
    )
  })
}
