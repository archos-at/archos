import type { JSX } from 'react'
import { Gauge } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canManageBudgets } from '@/lib/authz/organizations'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { BudgetUsageCard } from '../budget-usage-card'

export default async function OrganizationBudgetsPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    const isAdmin = canManageBudgets(session)

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.budgets.title')} subtitle={t('sections.budgets.subtitle')} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" aria-hidden />
              {isAdmin ? t('budgets.title') : t('budgets.memberTitle')}
            </CardTitle>
            <CardDescription>
              {isAdmin ? t('budgets.description') : t('budgets.memberDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetUsageCard isAdmin={isAdmin} />
          </CardContent>
        </Card>
      </div>
    )
  })
}
