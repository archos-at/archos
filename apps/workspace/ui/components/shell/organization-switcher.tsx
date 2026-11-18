'use client'

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { ArrowLeftRight, Check } from 'lucide-react'
import { useAuth } from '@workos-inc/authkit-nextjs/components'

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { isFrameworkControlFlow } from '@/lib/analytics/control-flow-error'
import type { SwitchableOrganization } from '@/lib/organizations/switchable'

const AFTER_SWITCH = '/app/projects'

export function isNavigatingAway(error: unknown): boolean {
  return isFrameworkControlFlow(error)
}

export function OrganizationSwitcherMenu({
  organizations,
}: {
  organizations: readonly SwitchableOrganization[]
}): JSX.Element {
  const { switchToOrganization } = useAuth()
  const t = useTranslations(navCopy)
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const switchTo = useCallback(
    async (organizationId: string) => {
      setPending(organizationId)
      setFailed(false)
      try {
        await switchToOrganization(organizationId)
      } catch (error) {
        if (isNavigatingAway(error)) return
        setPending(null)
        setFailed(true)
        return
      }
      window.location.assign(AFTER_SWITCH)
    },
    [switchToOrganization],
  )

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2" data-testid="user-menu-switch-organization">
        <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden />
        {t('userMenu.switchOrganization')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            disabled={organization.current || pending !== null}
            onSelect={(event) => {
              event.preventDefault()
              void switchTo(organization.id)
            }}
            className="gap-2"
          >
            <span className="flex-1 truncate">{organization.name}</span>
            {organization.current && <Check className="size-4" aria-label={t('userMenu.currentOrganization')} />}
            {pending === organization.id && (
              <span className="text-xs text-muted-foreground">{t('userMenu.switchingOrganization')}</span>
            )}
          </DropdownMenuItem>
        ))}
        {failed && (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            {t('userMenu.switchOrganizationFailed')}
          </p>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
