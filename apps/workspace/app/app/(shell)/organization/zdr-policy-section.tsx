'use client'

import { type FC, useState } from 'react'
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { organizationCopy } from '@/i18n/namespaces/organization'
import type { ZdrBlockedGroup, ZdrCoverage } from '@/lib/model-config/zdr-coverage'
import { isKnownProvider } from './llm-credentials-card'

export type { ZdrBlockedGroup, ZdrCoverage }

export const ZdrPolicySection: FC<{
  zdrOnly: boolean
  zdrApplicable: boolean
  provider: string | null
  coverage: ZdrCoverage | null
  onChanged: () => Promise<void>
}> = ({ zdrOnly, zdrApplicable, provider, coverage, onChanged }) => {
  const t = useTranslations(organizationCopy)
  const tc = useTranslations(commonCopy)
  const providerLabel = (id: string | null): string =>
    isKnownProvider(id) ? t(`byok.providers.${id}`) : (id ?? 'BYOK')
  const [saving, setSaving] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [hintOpen, setHintOpen] = useState(false)

  const apply = async (enabled: boolean): Promise<void> => {
    setSaving(true)
    try {
      const res = await fetch('/api/organization/model-config/zdr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (res.status === 403) {
        toast.error(t('models.zdrErrorForbidden'))
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      await onChanged()
    } catch {
      toast.error(t('models.zdrError'))
    } finally {
      setSaving(false)
    }
  }

  const onToggle = (enabled: boolean): void => {
    if (enabled) {
      void apply(true)
      return
    }
    setAcknowledged(false)
    setDisableOpen(true)
  }

  const enforced = zdrOnly && zdrApplicable
  const blockedCount = coverage ? new Set(coverage.blockedGroups.map((entry) => entry.group)).size : 0

  return (
    <div className="flex flex-col gap-3">
      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title={t('models.zdrDisableTitle')}
        description={t('models.zdrDisableDescription')}
        confirmLabel={t('models.zdrDisableConfirm')}
        cancelLabel={tc('actions.cancel')}
        tone="destructive"
        icon={ShieldOff}
        confirmDisabled={!acknowledged}
        confirmTestId="zdr-disable-confirm"
        onConfirm={() => apply(false)}
      >
        <Field orientation="horizontal" className="mt-2 justify-start gap-2">
          <Checkbox
            id="zdr-disable-acknowledge"
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
          />
          <FieldLabel htmlFor="zdr-disable-acknowledge" className="font-normal text-foreground">
            {t('models.zdrDisableAcknowledge')}
          </FieldLabel>
        </Field>
      </ConfirmDialog>

      <Field orientation="horizontal" className="rounded-lg border p-4">
        <div className="flex min-w-0 gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <FieldLabel htmlFor="zdr-only-toggle">{t('models.zdrTitle')}</FieldLabel>
            {/* The legal paragraph is long: beside a switch on a phone it was
                about 25 lines, and the state the admin came for sat above a
                wall of text. Three lines and a toggle there; whole from `sm`. */}
            <FieldDescription className={cn('mt-0.5', !hintOpen && 'max-sm:line-clamp-3')}>
              {zdrApplicable
                ? t('models.zdrHint')
                : t('models.zdrNotApplicable', { provider: providerLabel(provider) })}
            </FieldDescription>
            <button
              type="button"
              aria-expanded={hintOpen}
              onClick={() => setHintOpen((open) => !open)}
              className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 -ml-1 rounded-sm px-1 text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:hidden"
            >
              {hintOpen ? t('models.zdrHintLess') : t('models.zdrHintMore')}
            </button>
          </div>
        </div>
        <Switch
          id="zdr-only-toggle"
          checked={enforced}
          disabled={saving || !zdrApplicable}
          onCheckedChange={onToggle}
          aria-label={t('models.zdrTitle')}
        />
      </Field>

      {zdrApplicable && !zdrOnly && (
        <Alert variant="destructive" data-testid="zdr-off-banner">
          <ShieldOff />
          <AlertTitle>{t('models.zdrOffTitle')}</AlertTitle>
          <AlertDescription>{t('models.zdrOffBody')}</AlertDescription>
        </Alert>
      )}
      {enforced && coverage?.status === 'unknown' && (
        <Alert variant="warning" data-testid="zdr-coverage-unknown">
          <ShieldAlert />
          <AlertDescription>{t('models.zdrCoverageUnknown')}</AlertDescription>
        </Alert>
      )}
      {enforced && blockedCount > 0 && (
        <Alert variant="warning" data-testid="zdr-blocked-summary">
          <ShieldAlert />
          <AlertDescription>{t('models.zdrBlockedSummary', { count: blockedCount })}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export const ZdrGroupNotice: FC<{ groupId: string; coverage: ZdrCoverage | null }> = ({ groupId, coverage }) => {
  const t = useTranslations(organizationCopy)
  if (!coverage) return null
  const blocked = coverage.blockedGroups.filter((entry) => entry.group === groupId)
  const unresolved = coverage.unresolvedGroups.includes(groupId)
  if (blocked.length === 0 && !unresolved) return null
  return (
    <div className="mt-1 flex flex-col gap-1" data-testid={`zdr-notice-${groupId}`}>
      {blocked.map((entry) => (
        <p key={entry.modelId} className="flex items-start gap-1.5 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t(entry.reason === 'not_zdr' ? 'models.zdrBlockedNotZdr' : 'models.zdrBlockedCapability', {
            model: entry.modelId,
            source: t(`models.zdrSource.${entry.source}`),
          })}
        </p>
      ))}
      {unresolved && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('models.zdrUnresolved')}
        </p>
      )}
    </div>
  )
}
