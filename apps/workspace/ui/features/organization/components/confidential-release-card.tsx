'use client'

import { useState, type JSX } from 'react'
import { toast } from 'sonner'
import { saveConfidentialReleaseForbidden } from '@/adapters/api/confidential-release-client'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

export interface ConfidentialReleaseCardProps {
  canEdit: boolean
  initial: boolean
}

export function ConfidentialReleaseCard({ canEdit, initial }: ConfidentialReleaseCardProps): JSX.Element {
  const t = useTranslations(organizationCopy)
  const [forbidden, setForbidden] = useState(initial)
  const [saving, setSaving] = useState(false)

  const toggle = async (next: boolean): Promise<void> => {
    setForbidden(next)
    setSaving(true)
    try {
      setForbidden(await saveConfidentialReleaseForbidden(next))
      toast.success(t('confidentialRelease.saved'))
    } catch {
      setForbidden(!next)
      toast.error(t('confidentialRelease.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="confidential-release">
      <Field orientation="horizontal" className="sm:max-w-xl">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="org-confidential-release">{t('confidentialRelease.label')}</FieldLabel>
          <FieldDescription>{t('confidentialRelease.hint')}</FieldDescription>
        </div>
        <Switch
          id="org-confidential-release"
          checked={forbidden}
          onCheckedChange={(next) => void toggle(next)}
          disabled={!canEdit || saving}
          aria-label={t('confidentialRelease.label')}
        />
      </Field>
      {!canEdit && <p className="text-muted-foreground text-xs">{t('confidentialRelease.readOnly')}</p>}
    </div>
  )
}
