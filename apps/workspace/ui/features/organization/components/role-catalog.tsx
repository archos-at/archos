'use client'

import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Item, ItemList } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { SectionCard } from '@/features/platform/components/section-card'
import { ROLES, findPermissionSpec, type PermissionTier, type RoleSpec } from '@/lib/authz/catalog'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

export const ACCESS_TIER_ORDER: readonly PermissionTier[] = [
  'org',
  'project',
  'folder',
  'platform',
]

export interface RoleCatalogProps {
  roles?: readonly RoleSpec[]
}

export function groupByTier<T extends { readonly tier: PermissionTier }>(
  items: readonly T[]
): readonly { tier: PermissionTier; items: readonly T[] }[] {
  return ACCESS_TIER_ORDER.map((tier) => ({
    tier,
    items: items.filter((item) => item.tier === tier),
  })).filter((group) => group.items.length > 0)
}

export function RoleCatalog({ roles = ROLES }: RoleCatalogProps): JSX.Element {
  const t = useTranslations(organizationCopy)
  const groups = groupByTier(roles)

  return (
    <SectionCard
      title={t('access.roles.title')}
      description={t('access.roles.description')}
      empty={groups.length === 0}
      emptyIcon={ShieldAlert}
      testId="role-catalog"
    >
      <div className="flex flex-col gap-8">
        {groups.map(({ tier, items }) => {
          const restricted = items.some((role) => role.scope === 'platform-org')

          return (
            <section key={tier} className="flex flex-col gap-3" data-testid={`role-tier-${tier}`}>
              <div className="flex flex-col gap-1">
                <SectionLabel as="h3">{t(`access.tiers.${tier}`)}</SectionLabel>
                {restricted ? (
                  <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t('access.roles.platformNotice')}
                  </p>
                ) : null}
              </div>

              <ItemList as="ul">
                {items.map((role) => (
                  <Item as="li" key={role.slug} className="flex-col items-stretch gap-0 p-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h4 className="text-sm font-medium">{role.name}</h4>
                      <code className="text-muted-foreground font-mono text-xs">{role.slug}</code>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">{role.description}</p>

                    {/* The count IS the heading: "0 permissions" is how a role
                        that grants nothing says so, with no empty list under it. */}
                    <SectionLabel as="p" className="mt-3">
                      {role.permissions.length === 1
                        ? t('access.roles.permissionCountOne')
                        : t('access.roles.permissionCountOther', { count: role.permissions.length })}
                    </SectionLabel>
                    {role.permissions.length > 0 ? (
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {role.permissions.map((slug) => {
                          const spec = findPermissionSpec(slug)
                          return (
                            <li
                              key={slug}
                              className="flex flex-wrap items-baseline gap-x-2 text-sm"
                            >
                              {spec ? <span>{spec.name}</span> : null}
                              <code className="text-muted-foreground font-mono text-xs">
                                {slug}
                              </code>
                              {spec?.deprecated ? (
                                <Badge variant="warning">
                                  {t('access.permissions.deprecated')}
                                </Badge>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </Item>
                ))}
              </ItemList>
            </section>
          )
        })}
      </div>
    </SectionCard>
  )
}
