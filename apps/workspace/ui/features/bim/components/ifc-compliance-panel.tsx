'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HelpCircle,
  MinusCircle,
  ShieldCheck,
  UserCheck,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { hasOpenWork, rulesWithOpenWork } from '@/lib/bim/rules'
import type { BimComplianceSummary, BimRuleResultWithConfirmation } from '@/lib/bim/rules'
import { buildModelHref } from '../lib/model-link'
import type { BimRuleFactKey } from '../hooks/use-bim-model'

export interface IfcCompliancePanelProps {
  rules: BimRuleResultWithConfirmation[] | null
  summary: BimComplianceSummary | null
  shoppingList: Array<{ path: string; elements: number; rules: string[] }> | null
  isLoading: boolean
  error: string | null
  truncated?: boolean
  projectId: string
  modelFilename: string
  onRetry?: () => void
  onShowElements?: (globalIds: string[], status: 'fail' | 'info') => void
  missingFacts: BimRuleFactKey[]
  factsFailed?: boolean
  confirmationsFailed?: boolean
  onRetryFacts?: () => void
  askHref: string | null
  onConfirm?: (ruleId: string, note: string) => Promise<void>
  onWithdraw?: (ruleId: string) => Promise<void>
  bcfHref: string | null
}

const VISIBLE_ROWS = 6

const TOUCH_LINK = 'pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center'

function verdictHref(
  projectId: string,
  modelFilename: string,
  globalIds: string[],
  status: 'fail' | 'info'
): string {
  return buildModelHref(projectId, {
    model: modelFilename,
    element: globalIds[0],
    highlights: [{ status, globalIds }],
    xray: true,
    tab: 'compliance',
  })
}

export function IfcCompliancePanel({
  rules,
  summary,
  shoppingList,
  isLoading,
  error,
  truncated = false,
  onRetry,
  onShowElements,
  projectId,
  modelFilename,
  missingFacts,
  factsFailed = false,
  confirmationsFailed = false,
  onRetryFacts,
  askHref,
  onConfirm,
  onWithdraw,
  bcfHref,
}: IfcCompliancePanelProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const openWork = rules === null ? 0 : rulesWithOpenWork(rules).length

  return (
    <section aria-labelledby="bim-compliance-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bim-compliance-heading" className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('compliance.title')}
        </h2>
        {bcfHref && openWork > 0 && (
          <Button asChild variant="secondary" size="sm">
            {/* `download` without a value: the filename comes from the
                response's Content-Disposition, which is the only place that
                knows which revision was exported. */}
            <a href={bcfHref} download>
              <Download className="size-3.5" aria-hidden="true" />
              {openWork === 1
                ? t('compliance.export.actionOne')
                : t('compliance.export.action', { count: openWork })}
            </a>
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('compliance.description')}</p>
      {bcfHref && openWork > 0 && (
        <p className="text-xs text-muted-foreground">{t('compliance.export.hint')}</p>
      )}

      {isLoading && <Spinner className="size-4" />}
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-destructive text-sm">{t('compliance.failed')}</p>
          {/* The rule the stage states and this panel used to break: "Every
              error state in this viewer used to be terminal." */}
          {onRetry && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onRetry}
            >
              {t('loadFailed.action')}
            </Button>
          )}
        </div>
      )}

      {/* Above the badges on purpose: it invalidates every number in them. */}
      {truncated && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('compliance.truncatedModel')}</span>
        </p>
      )}

      {summary && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="success">
            {t('compliance.badge.passing')} {summary.rulesPassing}
          </Badge>
          <Badge variant="destructive">
            {t('compliance.badge.failing')} {summary.rulesFailing}
          </Badge>
          {/* Same visual weight as a failure on purpose: an undecidable
              requirement is not a smaller problem, it is an unknown one. */}
          <Badge variant="warning">
            {t('compliance.badge.undecidable')} {summary.rulesUndecidable}
          </Badge>
          <Badge variant="secondary">
            {t('compliance.badge.notApplicable')} {summary.rulesNotApplicable}
          </Badge>
          {/*
            The fifth bucket. `summarizeBimRules` produces it and nothing
            rendered it, so on a model with no doors and no stairs a
            seven-rule catalogue showed badges summing to five — and the rows
            that explain why are below the fold.
          */}
          {summary.rulesEmpty > 0 && (
            <Badge variant="secondary">
              {t('compliance.badge.noElements')} {summary.rulesEmpty}
            </Badge>
          )}
        </div>
      )}

      {/*
        A brief that could not be READ, said as itself. The rules stand down
        either way, but "diese Angaben fehlen im Briefing" sends the reader to
        re-enter values that are already there, and coming back changes
        nothing.
      */}
      {/*
        The ledger, separately from the brief. A rule that HAS been signed off
        renders here with no signature and an invitation to confirm it again —
        so the reader has to be told the record is the thing that is missing,
        not the answer.
      */}
      {confirmationsFailed && (
        <p className="bg-warning-subtle text-warning flex flex-wrap items-center gap-2 rounded-md p-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('compliance.confirmed.readFailed')}</span>
        </p>
      )}
      {factsFailed && (
        <p className="bg-warning-subtle text-warning flex flex-wrap items-center gap-2 rounded-md p-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('compliance.factsFailed')}</span>
          {onRetryFacts && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={onRetryFacts}
            >
              {t('loadFailed.action')}
            </Button>
          )}
        </p>
      )}

      {missingFacts.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning-subtle p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t('compliance.missingFacts', {
              facts: missingFacts.map((key) => t(`compliance.factName.${key}`)).join(', '),
            })}{' '}
            {askHref && (
              <Link href={askHref} className={`underline underline-offset-2 ${TOUCH_LINK}`}>
                {t('compliance.setFacts')}
              </Link>
            )}
          </span>
        </p>
      )}

      {shoppingList && shoppingList.length > 0 && (
        <div className="rounded-lg border p-3">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {t('compliance.shoppingList.title')}
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">
            {t('compliance.shoppingList.description')}
          </p>
          <ul className="space-y-1 text-sm">
            {shoppingList.slice(0, 8).map((entry) => (
              <li key={entry.path} className="flex flex-wrap items-baseline gap-x-2">
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{entry.path}</code>
                <span className="text-muted-foreground">
                  {/* One sibling key per counted string — the translator
                      substitutes tokens and does not select plurals, and a
                      property missing from exactly one element is common. */}
                  {entry.elements === 1
                    ? t('compliance.shoppingList.countOne')
                    : t('compliance.shoppingList.count', { count: entry.elements })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rules && (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.ruleId}
              rule={rule}
              projectId={projectId}
              modelFilename={modelFilename}
              onConfirm={onConfirm}
              onWithdraw={onWithdraw}
              onShowElements={onShowElements}
            />
          ))}
        </ul>
      )}

      {rules && (
        <p className="text-xs text-muted-foreground">{t('compliance.disclaimer')}</p>
      )}
    </section>
  )
}

function RuleRow({
  rule,
  projectId,
  modelFilename,
  onConfirm,
  onWithdraw,
  onShowElements,
}: {
  rule: BimRuleResultWithConfirmation
  projectId: string
  modelFilename: string
  onConfirm?: (ruleId: string, note: string) => Promise<void>
  onWithdraw?: (ruleId: string) => Promise<void>
  onShowElements?: (globalIds: string[], status: 'fail' | 'info') => void
}): JSX.Element {
  const t = useTranslations(bimCopy)
  const checked = rule.passed + rule.failed + rule.undecidable

  const { Icon, tone } = !rule.applicable || rule.hint
    ? { Icon: MinusCircle, tone: 'text-muted-foreground' }
    : rule.failed > 0
      ? { Icon: AlertTriangle, tone: 'text-destructive' }
      : checked === 0
        ? { Icon: MinusCircle, tone: 'text-muted-foreground' }
        : // ANY undecidable element leaves the requirement unsettled, not met.
          rule.undecidable > 0
          ? { Icon: HelpCircle, tone: 'text-warning' }
          : { Icon: CheckCircle2, tone: 'text-success' }

  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {rule.titleDe}{' '}
            <span className="font-normal text-muted-foreground">
              ({rule.richtlinie}, Punkt {rule.clause})
            </span>
          </p>
          {/* The threshold, always — the architect checks the rule, not only
              the verdict. */}
          <p className="text-xs text-muted-foreground">{rule.thresholdDe}</p>
          {rule.hint && <p className="text-xs text-muted-foreground">{rule.hint}</p>}

          {!rule.applicable ? (
            <p className="text-xs text-muted-foreground">
              {t('compliance.notApplicable')}: {rule.notApplicableReason}
            </p>
          ) : checked === 0 ? (
            <p className="text-xs text-muted-foreground">{t('compliance.noElements')}</p>
          ) : (
            <>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t('compliance.counts', {
                  passed: rule.passed,
                  failed: rule.failed,
                  undecidable: rule.undecidable,
                })}
              </p>
              <VerdictList
                heading={t('compliance.failures')}
                verdicts={rule.failures}
                total={rule.failed}
                projectId={projectId}
                modelFilename={modelFilename}
                status="fail"
                tone="text-destructive"
                onShowElements={onShowElements}
              />
              <VerdictList
                heading={t('compliance.unknowns')}
                verdicts={rule.unknowns}
                total={rule.undecidable}
                projectId={projectId}
                modelFilename={modelFilename}
                status="info"
                tone="text-warning"
                onShowElements={onShowElements}
              />
              {rule.truncated && <p className="text-xs text-muted-foreground">{t('compliance.truncated')}</p>}
            </>
          )}

          <Confirmation rule={rule} onConfirm={onConfirm} onWithdraw={onWithdraw} />
        </div>
      </div>
    </li>
  )
}

function Confirmation({
  rule,
  onConfirm,
  onWithdraw,
}: {
  rule: BimRuleResultWithConfirmation
  onConfirm?: (ruleId: string, note: string) => Promise<void>
  onWithdraw?: (ruleId: string) => Promise<void>
}): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const noteRef = useRef<HTMLTextAreaElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const interacted = useRef(false)

  useEffect(() => {
    if (!interacted.current) return
    if (open) noteRef.current?.focus()
    else openerRef.current?.focus()
  }, [open])

  const [denied, setDenied] = useState(false)
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false)

  const needsHuman = hasOpenWork(rule)
  if (!needsHuman && !rule.confirmation) return null

  const submit = async (): Promise<void> => {
    if (!onConfirm) return
    setBusy(true)
    setFailed(false)
    try {
      await onConfirm(rule.ruleId, note.trim())
      interacted.current = true
      setOpen(false)
      setNote('')
    } catch (error) {
      if (error instanceof Error && error.message === '403') setDenied(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (): Promise<void> => {
    if (!onWithdraw) return
    setBusy(true)
    setFailed(false)
    try {
      await onWithdraw(rule.ruleId)
      interacted.current = true
      setConfirmingWithdraw(false)
    } catch (error) {
      if (error instanceof Error && error.message === '403') setDenied(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      {rule.confirmation && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-success">
            <UserCheck className="size-3.5" aria-hidden="true" />
            {t('compliance.confirmed.by', {
              who: rule.confirmation.confirmedBy,
              when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                new Date(rule.confirmation.confirmedAt)
              ),
            })}
          </span>
          {rule.confirmationStale && (
            <Badge variant="warning">{t('compliance.confirmed.stale')}</Badge>
          )}
          {rule.confirmation.note && (
            <span className="text-muted-foreground">„{rule.confirmation.note}“</span>
          )}
        </p>
      )}

      {rule.confirmationStale && (
        <p className="text-xs text-muted-foreground">{t('compliance.confirmed.staleHint')}</p>
      )}

      {onConfirm && !open && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="bim-confirm-open"
            ref={openerRef}
            onClick={() => {
              interacted.current = true
              setOpen(true)
            }}
          >
            {rule.confirmation
              ? t('compliance.confirmed.reconfirm')
              : t('compliance.confirmed.confirm')}
          </Button>
          {rule.confirmation &&
            onWithdraw &&
            (confirmingWithdraw ? (
              <>
                <span className="text-muted-foreground text-xs">
                  {t('compliance.confirmed.withdrawConfirm')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void withdraw()}
                  disabled={busy}
                >
                  {busy ? <Spinner className="size-3" /> : null}
                  {t('compliance.confirmed.withdraw')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingWithdraw(false)}
                  disabled={busy}
                >
                  {t('compliance.confirmed.cancel')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingWithdraw(true)}
                disabled={busy}
              >
                {t('compliance.confirmed.withdraw')}
              </Button>
            ))}
        </div>
      )}

      {onConfirm && open && (
        <div className="space-y-2">
          <Textarea
            ref={noteRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={t('compliance.confirmed.notePlaceholder')}
            aria-label={t('compliance.confirmed.noteLabel')}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="bim-confirm-save"
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? <Spinner className="size-3" /> : null}
              {t('compliance.confirmed.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                interacted.current = true
                setOpen(false)
              }}
            >
              {t('compliance.confirmed.cancel')}
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" data-testid="bim-confirmation-failed" className="text-xs text-destructive">
          {t('compliance.confirmed.failed')}
        </p>
      )}
      {/* A refusal, not a failure: no retry, because there is nothing to
          retry. Stated once and the form stays open with the note in it, so
          nothing the reader typed is lost. */}
      {denied && (
        <p role="alert" className="text-warning text-xs">
          {t('compliance.confirmed.denied')}
        </p>
      )}
    </div>
  )
}

function VerdictList({
  heading,
  verdicts,
  total,
  projectId,
  modelFilename,
  status,
  tone,
  onShowElements,
}: {
  heading: string
  verdicts: BimRuleResultWithConfirmation['failures']
  total: number
  projectId: string
  modelFilename: string
  status: 'fail' | 'info'
  tone: string
  onShowElements?: (globalIds: string[], status: 'fail' | 'info') => void
}): JSX.Element | null {
  const t = useTranslations(bimCopy)
  if (verdicts.length === 0) return null
  const shown = verdicts.slice(0, VISIBLE_ROWS)

  const show = (globalIds: string[], children: React.ReactNode, className: string) =>
    onShowElements ? (
      <button
        type="button"
        onClick={() => onShowElements(globalIds, status)}
        className={className}
      >
        {children}
      </button>
    ) : (
      <Link href={verdictHref(projectId, modelFilename, globalIds, status)} className={className}>
        {children}
      </Link>
    )

  return (
    <div className="mt-1 space-y-0.5">
      <p className={`text-xs font-medium ${tone}`}>
        {heading}{' '}
        {show(
          verdicts.map((verdict) => verdict.globalId),
          t('compliance.showInModel'),
          `font-normal underline underline-offset-2 ${TOUCH_LINK}`
        )}
      </p>
      <ul className="space-y-0.5">
        {shown.map((verdict) => (
          <li
            key={verdict.globalId}
            className="text-xs text-muted-foreground pointer-coarse:flex pointer-coarse:flex-wrap pointer-coarse:items-center pointer-coarse:pb-2"
          >
            {show(
              [verdict.globalId],
              verdict.name ?? verdict.globalId,
              `underline underline-offset-2 ${TOUCH_LINK}`
            )}
            {/* On a finger the name is a row of its own and what follows reads as
                its caption beneath, so the separators that joined them in one
                line of text go with the line. */}
            <span className="pointer-coarse:basis-full">
              <span className="pointer-coarse:hidden">{verdict.storeyName ? ' · ' : ' — '}</span>
              {verdict.storeyName}
              {verdict.storeyName ? ' — ' : ''}
              {verdict.reading}
            </span>
          </li>
        ))}
      </ul>
      {total > shown.length && (
        <p className="text-xs text-muted-foreground">
          {total - shown.length === 1
            ? t('compliance.moreOne')
            : t('compliance.more', { count: total - shown.length })}
        </p>
      )}
    </div>
  )
}
