'use client'

import { type FC, useCallback, useEffect, useState } from 'react'
import { ChartNoAxesColumn } from 'lucide-react'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { profileCopy } from '@/i18n/namespaces/profile'
import { isPosthogOptedOut, optInPosthog, optOutPosthog } from '@/lib/analytics/posthog'

interface UsageAnalyticsSettingsProps {
  available: boolean
}

export const UsageAnalyticsSettings: FC<UsageAnalyticsSettingsProps> = ({ available }) => {
  const t = useTranslations(profileCopy, 'usageAnalytics')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    setEnabled(!isPosthogOptedOut())
  }, [])

  const handleChange = useCallback((next: boolean) => {
    if (next) optInPosthog()
    else optOutPosthog()
    setEnabled(next)
  }, [])

  if (!available) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChartNoAxesColumn className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor="usage-analytics-toggle">{t('label')}</FieldLabel>
            <FieldDescription>{t('hint')}</FieldDescription>
          </div>
          <Switch
            id="usage-analytics-toggle"
            checked={enabled}
            onCheckedChange={handleChange}
            aria-label={t('label')}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
