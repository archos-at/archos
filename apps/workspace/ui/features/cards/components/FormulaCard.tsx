'use client'

import { useId, useMemo, useState, type FC } from 'react'
import { Info, RotateCcw, SlidersHorizontal, UserPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { QuantityInput, type QuantityIssue } from '@/components/ui/quantity-input'
import { SectionLabel } from '@/components/ui/section-label'
import { useReaderOverrides } from '@/features/a2ui/reader-inputs'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import {
  SchematicCard,
  StatusBadge,
  fmtComparator,
  missingLabel,
  provenanceLabel,
  provenanceTitle,
  statusLabel,
  worstStatus,
} from '../schematics/kit'
import { formatInput, formatResult } from '../lib/calculate'
import {
  FORMULA_SOURCES,
  changedInputs,
  compileFormula,
  inputSlots,
  judgeFormula,
  sourceValues,
  type CompiledFormula,
  type EditionHold,
  type FormulaCardData,
  type FormulaWords,
  type InputLabel,
  type InputSlot,
  type JudgedFormula,
  type LimitCheck,
  type TermKey,
} from '../lib/formulas'
import {
  CAVEAT_KEYS,
  CHECK_KEYS,
  COMPONENT_KEYS,
  HOLD_KEYS,
  INPUT_KEYS,
  LINE_KEYS,
  MEASURE_KEYS,
  STAIR_TYPE_KEYS,
  TERM_KEYS,
  TERM_METRES_KEYS,
  ZERO_QUANTITY_KEYS,
} from '../lib/formula-copy'
import { DerivationSteps } from './Derivation'

type FormulaCardProps = Pick<FormulaCardData, 'title' | 'formula' | 'note' | 'site_binding'>

const withUnit = (value: string, unit: string): string => (unit ? `${value} ${unit}` : value)

const inputLabel = (key: InputLabel, t: Translator): string => t(INPUT_KEYS[key])

const zeroQuantity = (key: InputLabel, t: Translator): string =>
  t(key === 'floorArea' ? ZERO_QUANTITY_KEYS.floorArea : ZERO_QUANTITY_KEYS.conductivity)

const termText = (key: TermKey, params: { group?: string | null; metres?: number } | undefined, t: Translator): string => {
  const values = { layer: params?.group ?? '', metres: params?.metres == null ? '' : String(params.metres) }
  const withMetres = params?.metres != null && key in TERM_METRES_KEYS
  return t(withMetres ? TERM_METRES_KEYS[key as keyof typeof TERM_METRES_KEYS] : TERM_KEYS[key], values)
}

const caseText = (formula: FormulaCardData['formula'], t: Translator): string | null => {
  switch (formula.name) {
    case 'u_value':
      return [t(COMPONENT_KEYS[formula.component]), formula.measure ? t(MEASURE_KEYS[formula.measure]) : null]
        .filter(Boolean)
        .join(' · ')
    case 'stair_step_rule':
      return t(STAIR_TYPE_KEYS[formula.stair_type])
    default:
      return null
  }
}

const wordsFor = (t: Translator): FormulaWords => ({
  line: (key, group) => t(LINE_KEYS[key], { layer: group ?? '' }),
  term: (key, params) => termText(key, params, t),
})

const sourceText = (slot: InputSlot): string =>
  [
    slot.input.source,
    slot.input.reference && [slot.input.reference.document, slot.input.reference.section].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' · ')

const RowSources: FC<{ slots: InputSlot[]; id: string; t: Translator }> = ({ slots, id, t }) => {
  const texts = slots.map(sourceText)
  const provenance = slots.find((slot) => slot.input.provenance)?.input.provenance
  const distinct = new Set(texts.filter(Boolean))
  if (distinct.size === 0 && !provenance) return null
  const line =
    distinct.size <= 1
      ? [...distinct][0]
      : slots
          .map((slot, index) => (texts[index] ? `${inputLabel(slot.labelKey, t)}: ${texts[index]}` : null))
          .filter(Boolean)
          .join(' · ')
  return (
    <span id={id} className="card-meta flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
      {line && <span className="[overflow-wrap:anywhere]">{line}</span>}
      {provenance && (
        <span className="rounded bg-muted px-1 py-px" title={provenanceTitle(provenance, t)}>
          {provenanceLabel(provenance, t)}
        </span>
      )}
    </span>
  )
}

const AssumptionChip: FC<{ label: string }> = ({ label }) => (
  <Chip variant="warning" size="sm">
    <UserPen aria-hidden="true" />
    {label}
  </Chip>
)

type ChangeHandler = (key: string, value: number | null, issue: QuantityIssue | null) => void

const InputField: FC<{
  slot: InputSlot
  value: number | null
  changed: boolean
  captioned: boolean
  rowName: string | null
  sourcesId: string | null
  onChange: ChangeHandler
  t: Translator
}> = ({ slot, value, changed, captioned, rowName, sourcesId, onChange, t }) => {
  const markerId = useId()
  const label = inputLabel(slot.labelKey, t)
  const sourceValue = slot.input.value
  const describedBy = [sourcesId, changed ? markerId : null].filter(Boolean).join(' ')
  const issueText = (issue: QuantityIssue): string => {
    switch (issue) {
      case 'notANumber':
        return t('cards.formula.invalidNumber')
      case 'zero':
        return t('cards.formula.zeroNotPossible', { quantity: zeroQuantity(slot.labelKey, t) })
      case 'outOfRange':
        return t('cards.formula.outOfRange', {
          min: formatInput(slot.min ?? 0),
          max: slot.max == null ? '∞' : formatInput(slot.max),
          unit: slot.unit,
        })
    }
  }
  return (
    <span className="flex flex-col items-end gap-1">
      {captioned && <span className="card-meta text-muted-foreground">{label}</span>}
      {slot.editable ? (
        <QuantityInput
          value={value}
          onValueChange={(next, issue) => onChange(slot.key, next, issue)}
          unit={slot.unit}
          label={rowName ? `${rowName}, ${label}` : label}
          placeholder={t('cards.formula.missingPlaceholder')}
          min={slot.min}
          max={slot.max}
          step={slot.step}
          positive={slot.positive}
          describedBy={describedBy || undefined}
          invalidMessage={issueText}
        />
      ) : (
        <span className="card-body flex h-9 items-baseline gap-1.5 pt-1.5 font-mono tabular-nums text-foreground">
          {value == null ? (
            <span className="font-sans italic text-muted-foreground">{missingLabel(t)}</span>
          ) : (
            withUnit(formatInput(value), slot.unit)
          )}
          <span className="card-meta font-sans text-muted-foreground">{t('cards.formula.fixed')}</span>
        </span>
      )}
      {changed && (
        <span
          id={markerId}
          className="card-meta flex max-w-[8.5rem] flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-right"
        >
          <AssumptionChip label={t('cards.formula.yourAssumption')} />
          <span className="text-muted-foreground">
            {sourceValue == null
              ? t('cards.formula.sourceMissing')
              : t('cards.formula.sourceValue', { value: withUnit(formatInput(sourceValue), slot.unit) })}
          </span>
        </span>
      )}
    </span>
  )
}

interface Row {
  name: string | null
  slots: InputSlot[]
}

const InputRowItem: FC<{
  row: Row
  values: Record<string, number | null>
  changed: Set<string>
  onChange: ChangeHandler
  t: Translator
}> = ({ row, values, changed, onChange, t }) => {
  const sourcesId = useId()
  const hasSources = row.slots.some((slot) => sourceText(slot) || slot.input.provenance)
  const title = row.name ?? inputLabel(row.slots[0].labelKey, t)
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <span className="flex min-w-0 flex-1 basis-[9rem] flex-col gap-0.5 pt-1.5">
        <span className="card-body text-foreground [overflow-wrap:anywhere]">{title}</span>
        <RowSources slots={row.slots} id={sourcesId} t={t} />
      </span>
      <span className="flex flex-wrap justify-end gap-x-3 gap-y-1.5">
        {row.slots.map((slot) => (
          <InputField
            key={slot.key}
            slot={slot}
            value={values[slot.key] ?? null}
            changed={changed.has(slot.key)}
            captioned={row.name !== null && row.slots.length > 1}
            rowName={row.name}
            sourcesId={hasSources ? sourcesId : null}
            onChange={onChange}
            t={t}
          />
        ))}
      </span>
    </li>
  )
}

const InputRows: FC<{
  slots: InputSlot[]
  values: Record<string, number | null>
  changed: Set<string>
  onChange: ChangeHandler
  t: Translator
}> = ({ slots, values, changed, onChange, t }) => {
  const rows: Row[] = []
  for (const slot of slots) {
    const last = rows[rows.length - 1]
    if (last && slot.group !== null && last.name === slot.group) last.slots.push(slot)
    else rows.push({ name: slot.group, slots: [slot] })
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, index) => (
        <InputRowItem
          key={`${row.name ?? row.slots[0].key}-${index}`}
          row={row}
          values={values}
          changed={changed}
          onChange={onChange}
          t={t}
        />
      ))}
    </ul>
  )
}

const quantityText = (check: LimitCheck, judged: JudgedFormula, t: Translator): string => {
  const { value, unit } = check.quantity
  if (value == null) return missingLabel(t)
  if (check.spec.quantity.kind === 'input') return withUnit(formatInput(value), unit)
  const display = judged.display[check.spec.quantity.index]
  return withUnit(formatResult(value, Math.max(display.decimals, check.decimals), display.fixed), unit)
}

const boundText = (check: LimitCheck, t: Translator): string => {
  const { limit, spec } = check
  if (limit == null) return `${fmtComparator(spec.limit.comparator === 'between' ? '>=' : spec.limit.comparator)} ${missingLabel(t)}`
  if (limit.comparator === 'between') {
    return withUnit(`${formatInput(limit.value)}–${formatInput(limit.upper ?? limit.value)}`, spec.unit)
  }
  return `${fmtComparator(limit.comparator)} ${withUnit(formatInput(limit.value), spec.unit)}`
}

const undecidedText = (
  check: LimitCheck,
  compiled: CompiledFormula,
  issues: Record<string, QuantityIssue>,
  t: Translator
): string => {
  if (check.spec.dependsOn.some((key) => issues[key])) return t('cards.formula.inputRejected')
  if (check.spec.unknownCase === 'measure') return t('cards.formula.measureUnknown')
  if (check.spec.unknownCase === 'majorRenovation') return t('cards.formula.majorRenovationUndecided')
  if (check.quantity.undecidable === 'undefined') {
    return compiled.zeroInput
      ? t('cards.formula.zeroNotPossible', { quantity: zeroQuantity(compiled.zeroInput, t) })
      : t('cards.formula.undefinedResult')
  }
  return t('cards.formula.cannotJudge')
}

const holdText = (hold: EditionHold, t: Translator): string =>
  t(HOLD_KEYS[hold.reason], { edition: hold.edition, binding: hold.binding ?? '' })

const spokenCheck = (check: LimitCheck, judged: JudgedFormula, t: Translator): string => {
  const said = { name: t(CHECK_KEYS[check.spec.id]), value: quantityText(check, judged, t), bound: boundText(check, t) }
  return check.hold
    ? t('cards.formula.checkHeldSpoken', { ...said, reason: holdText(check.hold, t) })
    : t('cards.formula.checkSpoken', { ...said, verdict: statusLabel(check.status, t) })
}

const CheckRow: FC<{
  check: LimitCheck
  judged: JudgedFormula
  compiled: CompiledFormula
  assumed: boolean
  issues: Record<string, QuantityIssue>
  t: Translator
}> = ({ check, judged, compiled, assumed, issues, t }) => {
  const { reference } = check.spec
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {check.hold ? (
          <Chip variant="info" size="sm">
            <Info aria-hidden="true" />
            {t('cards.formula.hold.label')}
          </Chip>
        ) : (
          <StatusBadge status={check.status} />
        )}
        <span className="card-body text-foreground">{t(CHECK_KEYS[check.spec.id])}</span>
        <span className="card-body font-mono tabular-nums text-foreground">{quantityText(check, judged, t)}</span>
        <span className="card-body font-mono text-muted-foreground">{boundText(check, t)}</span>
        {assumed && <AssumptionChip label={t('cards.formula.yourAssumption')} />}
      </div>
      <span className="card-meta text-muted-foreground">
        {[reference.document, reference.section, reference.edition].filter(Boolean).join(' · ')}
      </span>
      {check.hold && (
        <p className="card-caption max-w-prose text-muted-foreground">
          {holdText(check.hold, t)}
        </p>
      )}
      {check.status === 'needs_input' && (
        <p className="card-caption max-w-prose text-muted-foreground">{undecidedText(check, compiled, issues, t)}</p>
      )}
    </li>
  )
}

export const FormulaCard: FC<FormulaCardProps> = ({ title, formula, note, site_binding: siteBinding }) => {
  const t = useTranslations(chatCopy)
  const { overrides, change, reset } = useReaderOverrides()
  const [issues, setIssues] = useState<Record<string, QuantityIssue>>({})
  const [interacted, setInteracted] = useState(false)
  const [resetCount, setResetCount] = useState(0)

  const slots = useMemo(() => inputSlots(formula), [formula])
  const source = useMemo(() => sourceValues(formula), [formula])
  const words = useMemo(() => wordsFor(t), [t])
  const values = { ...source, ...overrides }
  const compiled = compileFormula(formula, values, words)
  const judged = judgeFormula(compiled, values, siteBinding)
  const changed = changedInputs(source, values)
  const verdict = worstStatus(judged.checks.filter((check) => !check.hold).map((check) => check.status))
  const editable = slots.some((slot) => slot.editable)
  const assumedChecks = new Set(
    judged.checks.filter((check) => check.spec.dependsOn.some((key) => changed.has(key))).map((check) => check.spec.id)
  )
  const tinted = judged.checks.find((check) => check.spec.id === compiled.tint)
  const tint = tinted && !tinted.hold ? tinted.status : null
  const caseLine = caseText(formula, t)

  const onChange: ChangeHandler = (key, value, issue) => {
    change(key, value)
    setIssues((previous) => {
      const next = { ...previous }
      if (issue) next[key] = issue
      else delete next[key]
      return next
    })
    setInteracted(true)
  }
  const onReset = () => {
    reset()
    setIssues({})
    setResetCount((count) => count + 1)
    setInteracted(true)
  }

  const spoken = judged.checks.map((check) => spokenCheck(check, judged, t)).join(' ')

  return (
    <SchematicCard
      icon={SlidersHorizontal}
      eyebrow={t('cards.formula.eyebrow')}
      title={title}
      verdict={verdict}
      verdictNote={changed.size > 0 ? <AssumptionChip label={t('cards.formula.withYourAssumptions')} /> : undefined}
      note={note}
      reference={FORMULA_SOURCES[formula.name]}
    >
      {editable && <p className="card-caption max-w-prose text-muted-foreground">{t('cards.formula.hint')}</p>}

      <section className="flex flex-col gap-2" aria-label={t('cards.formula.inputsLabel')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel as="h3">{t('cards.formula.inputsLabel')}</SectionLabel>
          {/* Always mounted, disabled while there is nothing to reset: a
              button that vanishes on press takes the keyboard focus with it. */}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={changed.size === 0 && Object.keys(issues).length === 0}
              aria-label={t('cards.formula.resetLabel')}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t('cards.formula.reset')}
            </Button>
          )}
        </div>
        {caseLine && <span className="card-meta text-muted-foreground">{caseLine}</span>}
        <InputRows key={resetCount} slots={slots} values={values} changed={changed} onChange={onChange} t={t} />
      </section>

      <section className="flex flex-col gap-2" aria-label={t('cards.formula.derivationLabel')}>
        <SectionLabel as="h3">{t('cards.formula.derivationLabel')}</SectionLabel>
        <DerivationSteps
          steps={compiled.steps}
          results={judged.results}
          display={judged.display}
          tint={tint}
          stepReference="label"
          undefinedText={() =>
            compiled.zeroInput
              ? t('cards.formula.zeroNotPossible', { quantity: zeroQuantity(compiled.zeroInput, t) })
              : undefined
          }
          t={t}
        />
        {changed.size > 0 && <p className="card-caption font-medium text-warning">{t('cards.formula.withAssumptions')}</p>}
      </section>

      <section className="flex flex-col gap-2" aria-label={t('cards.formula.checksLabel')}>
        <SectionLabel as="h3">{t('cards.formula.checksLabel')}</SectionLabel>
        <ul className="flex flex-col gap-2.5">
          {judged.checks.map((check) => (
            <CheckRow
              key={check.spec.id}
              check={check}
              judged={judged}
              compiled={compiled}
              assumed={assumedChecks.has(check.spec.id)}
              issues={issues}
              t={t}
            />
          ))}
        </ul>
      </section>

      {compiled.caveats.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={t('cards.formula.notesLabel')}>
          <ul className="flex flex-col gap-1">
            {compiled.caveats.map((caveat) => (
              <li key={caveat.key} className="card-caption max-w-prose text-muted-foreground">
                {t(CAVEAT_KEYS[caveat.key], caveat.params ?? {})}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Said after the reader changed something and the field settled, so a
          screen reader hears each verdict with its quantity and bound without
          leaving the field. */}
      <p className="sr-only" aria-live="polite">
        {interacted ? t('cards.formula.recomputed', { checks: spoken }) : ''}
      </p>
    </SchematicCard>
  )
}
