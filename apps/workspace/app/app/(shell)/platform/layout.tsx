import type { JSX } from 'react'
import { redirect } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { getUserSession } from '@/lib/auth/session'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { getNavFlags } from '@/lib/authz/nav'
import { BackLink, ShellContent } from '@/components/shell'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformNav } from '@/features/platform/components/platform-nav'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { platformPermissions } from '@/lib/authz/platform'
import { PlatformAccessProvider } from '@/features/platform/platform-access'

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<JSX.Element> {
  return runWithTenantSlot(async () => {
    const session = await getUserSession()
    if (!session && isAuthRequired()) {
      redirect('/')
    }
    const navFlags = await getNavFlags(session)
    const t = await getTranslations(platformCopy)
    const tOrg = await getTranslations(organizationCopy)

    const shell = (body: React.ReactNode): JSX.Element => (
      <ShellContent>
        <BackLink className="mb-6" fallbackHref="/app/projects" fallbackLabel={tOrg('backToApp')} />
        {body}
      </ShellContent>
    )

    if (!navFlags.canManagePlatform) {
      return shell(
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="text-muted-foreground size-4" aria-hidden />
              {t('notOwner.title')}
            </CardTitle>
            <CardDescription>{t('notOwner.description')}</CardDescription>
          </CardHeader>
        </Card>
      )
    }

    const permissions = [...((await platformPermissions(session)) ?? [])]

    return shell(
      <PlatformAccessProvider permissions={permissions}>
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <div className="lg:w-52 lg:shrink-0">
            <PlatformNav />
          </div>
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-base ease-entrance min-w-0 flex-1 motion-reduce:animate-none">
            {children}
          </div>
        </div>
      </PlatformAccessProvider>
    )
  })
}
