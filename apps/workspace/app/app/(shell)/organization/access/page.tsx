import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CustomRolesSection } from '@/features/organization/components/custom-roles-section'
import { PeopleDirectory } from '@/features/organization/components/people-directory'
import { PermissionReference } from '@/features/organization/components/permission-reference'
import { RoleCatalog } from '@/features/organization/components/role-catalog'
import { withPageSession } from '@/lib/auth/require-auth'
import { canManageMembers } from '@/lib/authz/organizations'
import {
  listOrganizationMembersWithRoles,
  type OrganizationMemberWithRole,
} from '@/lib/organizations/service'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'

export default async function OrganizationAccessPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    const header = (
      <PageHeader title={t('sections.access.title')} subtitle={t('sections.access.subtitle')} />
    )

    if (!canManageMembers(session)) {
      return (
        <div className="flex flex-col gap-6">
          {header}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="text-muted-foreground size-4" aria-hidden />
                {t('access.notAllowed.title')}
              </CardTitle>
              <CardDescription>{t('access.notAllowed.description')}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      )
    }

    let members: OrganizationMemberWithRole[] = []
    let membersError = false
    try {
      members = await listOrganizationMembersWithRoles(session.organizationId)
    } catch {
      membersError = true
    }

    return (
      <div className="flex flex-col gap-6">
        {header}

        {/* The tab labels are the views' own titles rather than a second set of
            strings: "People" heading the People card under a tab called anything
            else would be two names for one thing. */}
        <Tabs defaultValue="people">
          {/* Four labels are wider than a phone: the strip scrolls sideways
              under an edge fade instead of pushing the page wider. */}
          <HorizontalScroll aria-label={t('access.tabsScrollable')} className="rounded-lg" cue>
            <TabsList>
              <TabsTrigger value="people">{t('access.people.title')}</TabsTrigger>
              <TabsTrigger value="roles">{t('access.roles.title')}</TabsTrigger>
              <TabsTrigger value="custom-roles">{t('customRoles.title')}</TabsTrigger>
              <TabsTrigger value="permissions">{t('access.permissions.title')}</TabsTrigger>
            </TabsList>
          </HorizontalScroll>

          <TabsContent value="people" className="mt-4">
            <PeopleDirectory members={members} error={membersError} />
          </TabsContent>
          <TabsContent value="roles" className="mt-4">
            <RoleCatalog />
          </TabsContent>
          {/* The office's own roles (ADR-0087): built here in WorkOS, assigned
              on the People tab, named by restricted folders. */}
          <TabsContent value="custom-roles" className="mt-4">
            <CustomRolesSection />
          </TabsContent>
          <TabsContent value="permissions" className="mt-4">
            <PermissionReference />
          </TabsContent>
        </Tabs>
      </div>
    )
  })
}
