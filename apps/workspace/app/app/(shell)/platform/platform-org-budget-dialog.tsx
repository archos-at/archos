'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/ui/load-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlatformCan } from '@/features/platform/platform-access'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { formatCredits, formatTokens } from '@/lib/format'
import {
  fetchPlatformOrgBudget,
  PlatformBudgetRequestError,
  putPlatformIngestAllowance,
} from '@/lib/budgets/platform-client'
import { ingestAllowancePutSchema } from '@/lib/budgets/ingest-allowance-contract'
import { platformOrgBudgetPutSchema, type PlatformOrgBudget } from '@/lib/budgets/platform-contract'
import { formatDecimalInput, parseDecimalInput } from '@/lib/text/parse-decimal'

type LimitDraft =
  { ok: true; value: number | null } | { ok: false; message: 'invalid' | 'ambiguous' }

const readLimit = (raw: string, locale: string): LimitDraft => {
  const parsed = parseDecimalInput(raw, locale)
  if (parsed.status === 'blank') return { ok: true, value: null }
  if (parsed.status === 'invalid')
    return { ok: false, message: parsed.reason === 'ambiguous' ? 'ambiguous' : 'invalid' }
  const inRange = platformOrgBudgetPutSchema.shape.dailyLimit.safeParse(parsed.value).success
  return inRange ? { ok: true, value: parsed.value } : { ok: false, message: 'invalid' }
}

const readIngestAllowance = (raw: string, locale: string): LimitDraft => {
  const parsed = parseDecimalInput(raw, locale)
  if (parsed.status === 'blank') return { ok: true, value: null }
  if (parsed.status === 'invalid')
    return { ok: false, message: parsed.reason === 'ambiguous' ? 'ambiguous' : 'invalid' }
  const inRange = ingestAllowancePutSchema.shape.monthlyAllowance.safeParse(parsed.value).success
  return inRange ? { ok: true, value: parsed.value } : { ok: false, message: 'invalid' }
}

export function PlatformOrgBudgetDialog({
  organization,
  onClose,
}: {
  organization: { id: string; name: string }
  onClose: () => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const tc = useTranslations(commonCopy)
  const { locale } = useLocale()
  const mayManage = usePlatformCan(PLATFORM_PERMISSIONS.organizationsManage)
  const [budget, setBudget] = useState<PlatformOrgBudget | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [daily, setDaily] = useState('')
  const [monthly, setMonthly] = useState('')
  const [note, setNote] = useState('')
  const [ingest, setIngest] = useState('')

  useEffect(() => {
    let cancelled = false
    setError(false)
    fetchPlatformOrgBudget(organization.id)
      .then((result) => {
        if (cancelled) return
        setBudget(result)
        setDaily(formatDecimalInput(result.dailyLimit, locale))
        setMonthly(formatDecimalInput(result.monthlyLimit, locale))
        setIngest(
          result.ingest.explicit ? formatDecimalInput(result.ingest.monthlyAllowance, locale) : ''
        )
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [organization.id, retry, locale])

  const canManage = Boolean(budget?.canManage) && mayManage
  const dailyDraft = readLimit(daily, locale)
  const monthlyDraft = readLimit(monthly, locale)
  const draft =
    budget && dailyDraft.ok && monthlyDraft.ok
      ? platformOrgBudgetPutSchema.safeParse({
          unit: budget.unit,
          dailyLimit: dailyDraft.value,
          monthlyLimit: monthlyDraft.value,
          note: note.trim() || null,
        })
      : null
  const ingestDraft = readIngestAllowance(ingest, locale)
  const valid = draft?.success === true && ingestDraft.ok
  const limitsChanged =
    budget !== null &&
    ((dailyDraft.ok && dailyDraft.value !== budget.dailyLimit) ||
      (monthlyDraft.ok && monthlyDraft.value !== budget.monthlyLimit) ||
      note.trim() !== '')
  const ingestChanged =
    budget !== null &&
    ingestDraft.ok &&
    ingestDraft.value !== (budget.ingest.explicit ? budget.ingest.monthlyAllowance : null)
  const saveLimits = budget !== null && (limitsChanged || (!budget.explicit && !ingestChanged))
  const dirty = budget !== null && (limitsChanged || !budget.explicit || ingestChanged)
  const ingestDefault =
    budget === null
      ? null
      : monthlyDraft.ok
        ? monthlyDraft.value === null
          ? null
          : monthlyDraft.value * budget.ingest.defaultFactor
        : budget.ingest.defaultMonthlyAllowance

  const save = async (): Promise<void> => {
    if (!budget || !draft?.success || !ingestDraft.ok || !canManage) return
    setSaving(true)
    let step: 'limits' | 'ingest' = 'limits'
    try {
      if (saveLimits) await fetchPlatformOrgBudget(organization.id, draft.data)
      step = 'ingest'
      if (ingestChanged) {
        await putPlatformIngestAllowance(organization.id, {
          unit: budget.unit,
          monthlyAllowance: ingestDraft.value,
        })
      }
      toast.success(t('orgBudgets.saved'))
      onClose()
    } catch (error) {
      toast.error(
        t(
          error instanceof PlatformBudgetRequestError && error.status === 409
            ? 'orgBudgets.unitChanged'
            : step === 'ingest'
              ? 'orgBudgets.ingestSaveError'
              : 'orgBudgets.saveError'
        )
      )
    } finally {
      setSaving(false)
    }
  }

  const unitLabel = t(budget?.unit === 'token' ? 'orgBudgets.tokens' : 'orgBudgets.credits')
  const formatAmount = (amount: number): string =>
    budget?.unit === 'token' ? formatTokens(amount, locale) : formatCredits(amount, locale)
  const problem = (limit: LimitDraft): string | null =>
    limit.ok
      ? null
      : limit.message === 'ambiguous'
        ? t('numberField.ambiguous')
        : t('orgBudgets.invalid')

  const limitField = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void
  ): JSX.Element => {
    const message = problem(readLimit(value, locale))
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          className="tabular-nums"
          value={value}
          placeholder={t('pricing.unlimitedPlaceholder')}
          onChange={(event) => onChange(event.target.value)}
          disabled={saving}
          readOnly={!canManage}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-error org-budget-hint` : 'org-budget-hint'}
        />
        {message ? <FieldError id={`${id}-error`}>{message}</FieldError> : null}
      </Field>
    )
  }

  const ingestSection = (): JSX.Element | null => {
    if (!budget) return null
    const id = 'org-budget-ingest'
    const message = ingestDraft.ok
      ? null
      : ingestDraft.message === 'ambiguous'
        ? t('numberField.ambiguous')
        : t('orgBudgets.ingestInvalid')
    return (
      <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby={`${id}-title`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-title`} className="text-sm font-medium">
            {t('orgBudgets.ingestTitle')}
          </h3>
          <Badge variant={budget.ingest.explicit ? 'secondary' : 'outline'}>
            {t(
              budget.ingest.explicit
                ? 'orgBudgets.ingestExplicitBadge'
                : 'orgBudgets.ingestDefaultBadge'
            )}
          </Badge>
        </div>
        <dl className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('orgBudgets.ingestUsedMonth')}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
            {formatAmount(budget.ingest.monthUsed)} {unitLabel}
          </dd>
        </dl>
        <Field>
          <FieldLabel htmlFor={id}>{t('orgBudgets.ingestLabel', { unit: unitLabel })}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              value={ingest}
              placeholder={
                ingestDefault === null
                  ? t('orgBudgets.ingestDefaultUnlimited')
                  : t('orgBudgets.ingestDefaultPlaceholder', {
                      amount: formatAmount(ingestDefault),
                    })
              }
              onChange={(event) => setIngest(event.target.value)}
              disabled={saving}
              readOnly={!canManage}
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? `${id}-error ${id}-hint` : `${id}-hint`}
            />
            {canManage && ingest.trim() !== '' ? (
              <Button type="button" variant="ghost" onClick={() => setIngest('')} disabled={saving}>
                {t('orgBudgets.ingestUseDefault')}
              </Button>
            ) : null}
          </div>
          {message ? <FieldError id={`${id}-error`}>{message}</FieldError> : null}
          <FieldDescription id={`${id}-hint`}>
            {t('orgBudgets.ingestHint', { factor: budget.ingest.defaultFactor })}
          </FieldDescription>
        </Field>
      </section>
    )
  }

  const body = (): JSX.Element => {
    if (error) {
      return (
        <LoadError
          title={t('orgBudgets.loadError')}
          onRetry={() => setRetry((value) => value + 1)}
        />
      )
    }
    if (!budget) {
      return (
        <div className="flex flex-col gap-4" aria-hidden>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">{t('orgBudgets.usedToday')}</dt>
            <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
              {formatAmount(budget.dayUsed)} {unitLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">{t('orgBudgets.usedMonth')}</dt>
            <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
              {formatAmount(budget.monthUsed)} {unitLabel}
            </dd>
          </div>
        </dl>
        <div className="flex flex-col gap-4">
          {limitField(
            'org-budget-monthly',
            t('orgBudgets.monthly', { unit: unitLabel }),
            monthly,
            setMonthly
          )}
          {limitField(
            'org-budget-daily',
            t('orgBudgets.daily', { unit: unitLabel }),
            daily,
            setDaily
          )}
          <FieldDescription id="org-budget-hint">{t('orgBudgets.limitHint')}</FieldDescription>
        </div>
        {ingestSection()}
        {canManage ? (
          <Field>
            <FieldLabel htmlFor="org-budget-note">{t('orgBudgets.note')}</FieldLabel>
            <Input
              id="org-budget-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              disabled={saving}
            />
          </Field>
        ) : (
          <p className="text-muted-foreground text-sm">{t('orgBudgets.readOnly')}</p>
        )}
      </div>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{t('orgBudgets.title', { name: organization.name })}</DialogTitle>
            {budget ? (
              <Badge variant={budget.explicit ? 'secondary' : 'outline'}>
                {t(budget.explicit ? 'orgBudgets.explicit' : 'orgBudgets.default')}
              </Badge>
            ) : null}
          </div>
          <DialogDescription>{t('orgBudgets.description')}</DialogDescription>
        </DialogHeader>
        {body()}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {canManage ? tc('actions.cancel') : tc('actions.close')}
          </Button>
          {canManage && !error ? (
            <Button onClick={() => void save()} disabled={saving || !valid || !dirty}>
              {tc(saving ? 'states.saving' : 'actions.save')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
