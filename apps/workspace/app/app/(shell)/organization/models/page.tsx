import type { JSX } from 'react'
import { Cpu, KeyRound, ShieldAlert } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canManageModels } from '@/lib/authz/organizations'
import { FEATURE_FLAGS, isFeatureEnabled } from '@/lib/authz/feature-flags'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { ModelConfigCard } from '../model-config-card'
import { LlmCredentialsCard } from '../llm-credentials-card'

export default async function OrganizationModelsPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    const models =
      canManageModels(session) && isFeatureEnabled(session, FEATURE_FLAGS.modelConfiguration)
    const byok = canManageModels(session) && isFeatureEnabled(session, FEATURE_FLAGS.byokLlm)

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.models.title')} subtitle={t('sections.models.subtitle')} />

        {/* Runtime model configuration (ADR-0014) */}
        {models && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" aria-hidden />
                {t('models.title')}
              </CardTitle>
              <CardDescription>{t('models.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ModelConfigCard />
            </CardContent>
          </Card>
        )}

        {/* BYOK LLM credentials (ADR-0022) */}
        {byok && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" aria-hidden />
                {t('byok.title')}
              </CardTitle>
              <CardDescription>{t('byok.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <LlmCredentialsCard />
            </CardContent>
          </Card>
        )}

        {!models && !byok && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
                {t('notAdmin.title')}
              </CardTitle>
              <CardDescription>{t('notAdmin.description')}</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    )
  })
}
