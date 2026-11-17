'use client'

import { useId, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { motion, springGlide } from '@/components/motion'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { modeKeyFor } from '@/lib/project-profile/intake-building-keys'
import type { IntakeAnswerMode, ProjectIntakeQuestion } from '@/lib/project-profile/intake-types'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'

type Answers = Record<string, ProjectPrimitiveValue>

export function QuestionControl({
  question,
  answerKey,
  answers,
  error,
  onSetAnswer,
  onSetMode,
}: {
  question: ProjectIntakeQuestion
  answerKey: string
  answers: Answers
  error: string | null
  onSetAnswer: (key: string, value: ProjectPrimitiveValue) => void
  onSetMode: (key: string, mode: IntakeAnswerMode) => void
}) {
  const t = useTranslations(projectsCopy)
  const value = answers[answerKey]
  const domId = `q-${answerKey}`
  const header = <QuestionHeader question={question} domId={domId} />
  const errorText = error ? (
    <p id={`${domId}-error`} className="text-destructive text-sm">
      {error}
    </p>
  ) : null

  switch (question.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <Input
            id={domId}
            type="text"
            value={typeof value === 'string' ? value : ''}
            placeholder={question.placeholder}
            aria-invalid={error ? true : undefined}
            enterKeyHint="next"
            onChange={(e) => onSetAnswer(answerKey, e.target.value)}
            className="max-w-md"
          />
          {errorText}
        </div>
      )
    case 'textarea':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <Textarea
            id={domId}
            value={typeof value === 'string' ? value : ''}
            placeholder={question.placeholder}
            onChange={(e) => onSetAnswer(answerKey, e.target.value)}
            className="min-h-24 max-w-2xl"
          />
          {errorText}
        </div>
      )
    case 'number':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <div className="flex items-center gap-2">
            <Input
              id={domId}
              type="number"
              inputMode="decimal"
              placeholder={question.placeholder}
              value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === '') return onSetAnswer(answerKey, '')
                const parsed = Number(raw)
                onSetAnswer(answerKey, Number.isFinite(parsed) ? parsed : raw)
              }}
              className="max-w-40"
            />
            {/* The unit beside the field: „1250“ alone does not say m² or m. */}
            {question.unit && <span className="text-muted-foreground text-sm">{question.unit}</span>}
          </div>
          {errorText}
        </div>
      )
    case 'number_tri':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <NumberTriControl
            domId={domId}
            question={question}
            value={value}
            mode={(answers[modeKeyFor(answerKey)] as IntakeAnswerMode) ?? 'value'}
            onValue={(v) => onSetAnswer(answerKey, v)}
            onMode={(m) => onSetMode(answerKey, m)}
          />
          {errorText}
        </div>
      )
    case 'yes_no_open':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <Segmented
            ariaLabel={question.label}
            value={typeof value === 'string' ? value : ''}
            options={[
              { value: 'yes', label: t('intake.yes') },
              { value: 'no', label: t('intake.no') },
              { value: 'open', label: t('intake.open'), tone: 'muted' },
            ]}
            onChange={(v) => onSetAnswer(answerKey, v)}
          />
          {errorText}
        </div>
      )
    case 'boolean':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <Segmented
            ariaLabel={question.label}
            value={value === true ? 'yes' : value === false ? 'no' : ''}
            options={[
              { value: 'yes', label: t('intake.yes') },
              { value: 'no', label: t('intake.no') },
            ]}
            onChange={(v) => onSetAnswer(answerKey, v === 'yes')}
          />
          {errorText}
        </div>
      )
    case 'single_select':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(v) => onSetAnswer(answerKey, v)}
          >
            <SelectTrigger
              id={domId}
              className="w-full max-w-md"
              aria-invalid={error ? true : undefined}
            >
              <SelectValue placeholder={t('intake.selectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(question.options ?? []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorText}
        </div>
      )
    case 'multi_select':
      return (
        <div className="flex flex-col gap-2">
          {header}
          <ChipMultiSelect
            question={question}
            value={Array.isArray(value) ? value : []}
            onChange={(next) => onSetAnswer(answerKey, next)}
          />
          {errorText}
        </div>
      )
    default:
      return null
  }
}

export function QuestionHeader({ question, domId }: { question: ProjectIntakeQuestion; domId: string }) {
  const t = useTranslations(projectsCopy)
  const [whyOpen, setWhyOpen] = useState(false)
  const whyId = `${domId}-why`
  return (
    <div className="flex flex-col gap-1">
      {/* `items-center` on touch: the rationale glyph beside the label is a full
          44px control there, and baseline alignment would hang it off the label's
          text baseline instead of centring it in the row it now defines. */}
      <div className="flex items-baseline gap-2 pointer-coarse:items-center">
        <Label htmlFor={domId} className="text-sm font-medium">
          {question.label}
          {/* Mark the handful of hard-required fields so they're distinguishable
              from the ~90 soft ones BEFORE Next is pressed (error prevention),
              mirroring the FieldShell required marker used elsewhere. */}
          {question.required && (
            <span aria-hidden className="text-destructive">
              {' '}
              *
            </span>
          )}
        </Label>
        {question.optional && (
          <span className="text-muted-foreground text-xs font-normal">{t('intake.optional')}</span>
        )}
        {/* The rationale rides ON the label row as a glyph rather than under it
            as its own "Warum fragen wir das?" line. Nearly every question in the
            catalog carries a `why`, so a per-field row put a second, louder
            control beside every label — an accordion the length of the form
            competing with the questions it annotates. */}
        {question.why && (
          <button data-attr="project-why-open"
            type="button"
            onClick={() => setWhyOpen((previous) => !previous)}
            aria-expanded={whyOpen}
            aria-controls={whyId}
            aria-label={t('intake.why')}
            title={t('intake.why')}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 pointer-coarse:size-11 inline-flex size-4 shrink-0 items-center justify-center self-center rounded-full outline-none transition-colors duration-quick ease-out focus-visible:ring-2 motion-reduce:transition-none"
          >
            <HelpCircle className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {question.why && whyOpen && (
        <p
          id={whyId}
          className="bg-muted text-muted-foreground max-w-prose rounded-control px-3 py-2 text-xs"
        >
          {question.why}
        </p>
      )}
      {question.help && <p className="text-muted-foreground text-xs">{question.help}</p>}
    </div>
  )
}

export function NumberTriControl({
  domId,
  question,
  value,
  mode,
  onValue,
  onMode,
}: {
  domId: string
  question: ProjectIntakeQuestion
  value: ProjectPrimitiveValue
  mode: IntakeAnswerMode
  onValue: (v: ProjectPrimitiveValue) => void
  onMode: (m: IntakeAnswerMode) => void
}) {
  const t = useTranslations(projectsCopy)
  const disabled = mode === 'open'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={domId}
          type="number"
          inputMode="decimal"
          disabled={disabled}
          placeholder={question.placeholder}
          value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onValue('')
            const parsed = Number(raw)
            onValue(Number.isFinite(parsed) ? parsed : raw)
          }}
          className="max-w-32 font-mono"
        />
        {question.unit && (
          <span className="text-muted-foreground font-mono text-xs">{question.unit}</span>
        )}
        <Segmented
          ariaLabel={t('intake.mode.aria')}
          size="sm"
          value={mode}
          options={[
            { value: 'value', label: t('intake.mode.wert') },
            { value: 'estimated', label: t('intake.mode.geschaetzt'), tone: 'warning' },
            { value: 'open', label: t('intake.mode.offen'), tone: 'muted' },
          ]}
          onChange={(v) => onMode(v as IntakeAnswerMode)}
        />
      </div>
      {question.hint && <p className="text-muted-foreground max-w-xl text-xs">{question.hint}</p>}
    </div>
  )
}

type SegmentTone = 'default' | 'warning' | 'muted'

export function Segmented({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
}: {
  value: string
  options: { value: string; label: string; tone?: SegmentTone }[]
  onChange: (value: string) => void
  ariaLabel: string
  size?: 'sm' | 'md'
}) {
  const pillId = useId()
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="border-border inline-flex w-fit flex-wrap self-start overflow-hidden rounded-control border"
    >
      {options.map((opt, i) => {
        const active = value === opt.value
        const tone = opt.tone ?? 'default'
        return (
          <button data-attr="project-change"
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'border-border relative isolate inline-flex items-center justify-center transition-colors duration-quick ease-out motion-reduce:transition-none',
              i > 0 && 'border-l',
              size === 'sm'
                ? 'min-h-8 px-2.5 text-[11px] font-medium pointer-coarse:min-h-11 pointer-coarse:px-3.5 pointer-coarse:text-xs'
                : 'min-h-9 px-3.5 text-sm pointer-coarse:min-h-11 pointer-coarse:px-4',
              !active && 'bg-card text-foreground hover:bg-sheet-hover',
              active && tone === 'default' && 'text-primary-foreground',
              active && tone === 'warning' && 'text-white',
              active && tone === 'muted' && 'text-background'
            )}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                transition={springGlide}
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 -z-10',
                  tone === 'default' && 'bg-primary',
                  tone === 'warning' && 'bg-warning',
                  tone === 'muted' && 'bg-muted-foreground'
                )}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ChipMultiSelect({
  question,
  value,
  onChange,
}: {
  question: ProjectIntakeQuestion
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="flex max-w-2xl flex-wrap gap-2">
      {(question.options ?? []).map((opt) => {
        const active = value.includes(opt.value)
        return (
          <button data-attr="project-change"
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(active ? value.filter((v) => v !== opt.value) : [...value, opt.value])
            }
            className={cn(
              'inline-flex min-h-9 items-center justify-center rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:min-h-11 pointer-coarse:px-4',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-sheet-hover'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
