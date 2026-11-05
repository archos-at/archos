'use client'

/**
 * The person's switch for the weekly "Neu diese Woche" notice, on the profile page (ADR-0154,
 * amendment). "Nicht mehr anzeigen" on the notice turns it off; this turns it back on, and the
 * notice resumes with the next week published. The "Neuerungen" page stays in the user menu
 * either way. Stored per person on the server (`release_summary_notice`), so it holds on every
 * device.
 */

import { useState, type FC } from 'react'
import { Sparkles } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { whatsNewCopy } from '@/i18n/namespaces/whats-new'
import { capturePosthog } from '@/lib/analytics/posthog'
import { putReleaseNoticePreference } from '@/lib/release-notes/client'

export const WhatsNewNoticeSettings: FC<{ initialEnabled: boolean }> = ({ initialEnabled }) => {
  const t = useTranslations(whatsNewCopy, 'settings')
  const [enabled, setEnabled] = useState(initialEnabled)
  const [failed, setFailed] = useState(false)

  const change = async (next: boolean): Promise<void> => {
    setEnabled(next)
    setFailed(false)
    const kept = await putReleaseNoticePreference(next)
    if (!kept) {
      setEnabled(!next)
      setFailed(true)
      return
    }
    capturePosthog(next ? 'whats_new_opted_in' : 'whats_new_opted_out', { surface: 'profile' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor="whats-new-notice-toggle">{t('label')}</FieldLabel>
            <FieldDescription>{t('hint')}</FieldDescription>
            {failed && (
              <p role="alert" className="text-destructive text-xs">
                {t('failed')}
              </p>
            )}
          </div>
          <Switch
            id="whats-new-notice-toggle"
            checked={enabled}
            onCheckedChange={(next) => void change(next)}
            aria-label={t('label')}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
