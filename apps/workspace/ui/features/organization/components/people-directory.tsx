'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import { UsersManagement, WorkOsWidgets } from '@workos-inc/widgets'
import { Users } from 'lucide-react'
import '@radix-ui/themes/styles.css'

import { Badge } from '@/components/ui/badge'
import { Item, ItemList } from '@/components/ui/item'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import { findRoleSpec } from '@/lib/authz/catalog'
import type { OrganizationMemberWithRole } from '@/lib/organizations/service'
import { makeWidgetTokenFetcher } from '@/lib/workos/widget-token'
import { useResolvedAppearance, widgetTheme } from '@/lib/workos/use-widget-appearance'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

export interface PeopleDirectoryProps {
  members: readonly OrganizationMemberWithRole[]
  error?: boolean
  showManagement?: boolean
}

function RoleLabel({ slug }: { slug: string | null }): JSX.Element {
  const t = useTranslations(organizationCopy)
  if (!slug) return <span className="text-muted-foreground">{t('access.people.noRole')}</span>
  const roleName = findRoleSpec(slug)?.name
  return (
    <div className="flex flex-col gap-0.5">
      {/* Name above, slug below — and only the slug when the catalog has no
          name for it, because printing the same string twice reads as a
          rendering fault. */}
      <span>{roleName ?? slug}</span>
      {roleName ? <code className="text-muted-foreground font-mono text-xs">{slug}</code> : null}
    </div>
  )
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  return <Badge variant={status.toLowerCase() === 'active' ? 'success' : 'secondary'}>{status}</Badge>
}

export function PeopleDirectory({
  members,
  error = false,
  showManagement = true,
}: PeopleDirectoryProps): JSX.Element {
  const t = useTranslations(organizationCopy)
  const appearance = useResolvedAppearance()
  const usersToken = useMemo(() => makeWidgetTokenFetcher(['widgets:users-table:manage']), [])

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title={t('access.people.title')}
        description={t('access.people.description')}
        error={error}
        errorMessage={t('access.people.loadError')}
        empty={members.length === 0}
        emptyIcon={Users}
        emptyTitle={t('access.people.empty')}
        testId="people-directory"
      >
        {/* Phone: one card per person. */}
        <ItemList as="ul" className="sm:hidden" data-testid="people-cards">
          {members.map((member) => (
            <Item as="li" key={member.id} className="flex-col items-stretch gap-1.5 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words font-medium">
                  {member.name ?? <span className="text-muted-foreground font-normal">—</span>}
                </p>
                <StatusBadge status={member.status} />
              </div>
              <p className="text-muted-foreground min-w-0 break-all text-sm">{member.email}</p>
              <div className="text-sm">
                <RoleLabel slug={member.roleSlug} />
              </div>
            </Item>
          ))}
        </ItemList>

        <Table className="max-sm:hidden">
          <TableHeader>
            <TableRow>
              <TableHead>{t('access.people.columnName')}</TableHead>
              <TableHead>{t('access.people.columnEmail')}</TableHead>
              <TableHead>{t('access.people.columnRole')}</TableHead>
              <TableHead>{t('access.people.columnStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">
                  {member.name ?? <span className="text-muted-foreground font-normal">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{member.email}</TableCell>
                <TableCell>
                  <RoleLabel slug={member.roleSlug} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={member.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* The mutation half. Same scoped token fetcher the organization overview
          uses, so a caller without `widgets:users-table:manage` gets a refusal
          from the token route rather than a widget that half-works. */}
      {showManagement ? (
        <WorkOsWidgets theme={widgetTheme(appearance)}>
          <Card>
            <CardHeader>
              <CardTitle>{t('members.title')}</CardTitle>
              <CardDescription>{t('members.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <UsersManagement authToken={usersToken} />
            </CardContent>
          </Card>
        </WorkOsWidgets>
      ) : null}
    </div>
  )
}
