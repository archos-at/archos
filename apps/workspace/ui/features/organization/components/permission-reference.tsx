'use client'

import type { JSX } from 'react'
import { KeyRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { SectionLabel } from '@/components/ui/section-label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import {
  ALL_PERMISSION_SPECS,
  ROLES,
  type PermissionSpec,
  type RoleSpec,
} from '@/lib/authz/catalog'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { groupByTier } from './role-catalog'

export interface PermissionReferenceProps {
  permissions?: readonly PermissionSpec[]
  roles?: readonly RoleSpec[]
}

export function invertRoles(roles: readonly RoleSpec[]): ReadonlyMap<string, readonly RoleSpec[]> {
  const granting = new Map<string, RoleSpec[]>()
  for (const role of roles) {
    for (const slug of role.permissions) {
      const existing = granting.get(slug)
      if (existing) existing.push(role)
      else granting.set(slug, [role])
    }
  }
  return granting
}

export function PermissionReference({
  permissions = ALL_PERMISSION_SPECS,
  roles = ROLES,
}: PermissionReferenceProps): JSX.Element {
  const t = useTranslations(organizationCopy)
  const granting = invertRoles(roles)
  const groups = groupByTier(permissions)

  return (
    <SectionCard
      title={t('access.permissions.title')}
      description={t('access.permissions.description')}
      empty={groups.length === 0}
      emptyIcon={KeyRound}
      testId="permission-reference"
    >
      <div className="flex flex-col gap-8">
        {groups.map(({ tier, items }) => (
          <section
            key={tier}
            className="flex flex-col gap-2"
            data-testid={`permission-tier-${tier}`}
          >
            <SectionLabel as="h3">{t(`access.tiers.${tier}`)}</SectionLabel>

            {/* From `sm` a two-column table. On a phone each row stacks (the
                permission, then who grants it) and the header row steps out of
                sight, because the description and the role badges cannot share
                393px side by side. */}
            <Table>
              <TableHeader className="max-sm:sr-only">
                <TableRow>
                  <TableHead>{t('access.permissions.columnPermission')}</TableHead>
                  <TableHead>{t('access.permissions.grantedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((permission) => {
                  const grantedBy = granting.get(permission.slug) ?? []
                  return (
                    <TableRow key={permission.slug} className="max-sm:block max-sm:py-3">
                      <TableCell className="align-top max-sm:block max-sm:p-0">
                        <div className="flex max-w-xl flex-col gap-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-medium">{permission.name}</span>
                            <code className="text-muted-foreground font-mono text-xs">
                              {permission.slug}
                            </code>
                            {permission.deprecated ? (
                              <Badge variant="warning">{t('access.permissions.deprecated')}</Badge>
                            ) : null}
                          </div>
                          <p className="text-muted-foreground text-sm">{permission.description}</p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top max-sm:mt-2 max-sm:block max-sm:p-0">
                        <span className="text-muted-foreground mb-1 block text-xs sm:hidden">
                          {t('access.permissions.grantedBy')}
                        </span>
                        {grantedBy.length === 0 ? (
                          <span className="text-muted-foreground text-sm">
                            {t('access.permissions.noRoles')}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {grantedBy.map((role) => (
                              <Badge key={role.slug} variant="secondary">
                                {role.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </section>
        ))}
      </div>
    </SectionCard>
  )
}
