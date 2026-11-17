'use client'

import { type FC } from 'react'
import { PanelRight } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { profileCopy } from '@/i18n/namespaces/profile'
import { autoPreference, setViewerActionsAuto, useViewerActionStore } from '@/features/chat/lib/viewer-actions'

export const ViewerActionsSettings: FC = () => {
  const t = useTranslations(profileCopy, 'viewerActions')
  const auto = useViewerActionStore(autoPreference)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PanelRight className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor="viewer-actions-toggle">{t('label')}</FieldLabel>
            <FieldDescription>{t('hint')}</FieldDescription>
          </div>
          <Switch
            id="viewer-actions-toggle"
            checked={auto}
            onCheckedChange={setViewerActionsAuto}
            aria-label={t('label')}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
