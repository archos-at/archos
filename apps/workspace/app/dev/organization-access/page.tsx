'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'

import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PeopleDirectory } from '@/features/organization/components/people-directory'
import { PermissionReference } from '@/features/organization/components/permission-reference'
import { RoleCatalog } from '@/features/organization/components/role-catalog'
import type { OrganizationMemberWithRole } from '@/lib/organizations/service'
import { I18nProvider, useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

const MEMBERS: OrganizationMemberWithRole[] = [
  {
    id: 'user_01',
    email: 'matthias.bigl@buero.at',
    name: 'Matthias Bigl',
    roleSlug: 'admin',
    status: 'active',
  },
  {
    id: 'user_02',
    email: 'anna.weber@buero.at',
    name: 'Anna Weber',
    roleSlug: 'org-billing-admin',
    status: 'active',
  },
  {
    id: 'user_03',
    email: 'klaus.berger@buero.at',
    name: 'Klaus Berger',
    roleSlug: 'org-compliance-officer',
    status: 'active',
  },
  {
    id: 'user_04',
    email: 'sabine.gruber@buero.at',
    name: 'Sabine Gruber',
    roleSlug: 'org-fire-marshal',
    status: 'active',
  },
  {
    id: 'user_05',
    email: 'eva.ritter@buero.at',
    name: 'Eva Ritter',
    roleSlug: 'member',
    status: 'pending',
  },
  {
    id: 'user_06',
    email: 'jonas.steiner@buero.at',
    name: null,
    roleSlug: null,
    status: 'inactive',
  },
]

type View = 'people' | 'roles' | 'permissions'

const isView = (value: string | null): value is View =>
  value === 'people' || value === 'roles' || value === 'permissions'

function Preview(): JSX.Element {
  const t = useTranslations(organizationCopy)
  const [view, setView] = useState<View>('people')
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view')
    if (isView(requested)) setView(requested)
  }, [])

  return (
    <main
      data-testid="organization-access-preview"
      className="text-foreground mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-8"
    >
      <div>
        <h1 className="text-page-title font-medium phone:text-section">{t('sections.access.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('sections.access.subtitle')}</p>
      </div>

      {/* The real sub-tab strip, so the shot shows how the three views are
          reached. `value` is controlled here because the route, not a click,
          decides which one is captured. */}
      <Tabs value={view}>
        <HorizontalScroll aria-label={t('access.tabsScrollable')} className="rounded-lg" cue>
          <TabsList>
            <TabsTrigger value="people">{t('access.people.title')}</TabsTrigger>
            <TabsTrigger value="roles">{t('access.roles.title')}</TabsTrigger>
            <TabsTrigger value="custom-roles">{t('customRoles.title')}</TabsTrigger>
            <TabsTrigger value="permissions">{t('access.permissions.title')}</TabsTrigger>
          </TabsList>
        </HorizontalScroll>
      </Tabs>

      {view === 'people' ? (
        <PeopleDirectory members={MEMBERS} showManagement={false} />
      ) : view === 'roles' ? (
        <RoleCatalog />
      ) : (
        <PermissionReference />
      )}
    </main>
  )
}

export default function OrganizationAccessDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
