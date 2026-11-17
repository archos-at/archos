'use client'

import type { JSX } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FieldShell, useAppForm } from '@/components/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemList, ItemTitle } from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SearchField } from '@/components/ui/search-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import {
  createSkill,
  deleteSkill,
  updateSkill,
  type CreateSkillInput,
  type SkillCategoryListItem,
  type SkillListItem,
} from '@/adapters/api/skills-client'
import {
  CARD_CATALOG,
  formatPreferredCardTypes,
  parsePreferredCardTypes,
  searchCardCatalog,
} from '../lib/card-catalog'
import {
  formatAgentScope,
  parseAgentScope,
  SKILL_AGENTS,
  type AgentScope,
} from '../lib/agent-scope'
import { renderSkillDocument, type ParsedSkillDocument } from '../lib/skill-document'
import { MarkdownEditor, type MarkdownEditorLabels } from './MarkdownEditor'
import { SkillRawDocumentSection } from './SkillRawDocumentSection'
import { SkillDocumentPreview } from './SkillDocumentPreview'
import { Stepper } from '@/components/ui/stepper'
import { Advanced, StepHeading } from '@/components/ui/step-form'
import { SkillFindingList } from './SkillFindingList'
import { SkillReviewPanel } from './SkillReviewPanel'
import { useSkillReview, type SkillReviewField } from '../hooks/use-skill-review'
import { capturePosthog } from '@/lib/analytics/posthog'

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

const DESCRIPTION_MAX = 1024

function withoutReservedKeys(metadata: Record<string, string>): Record<string, string> {
  const owned = new Set([
    METADATA_CARDS,
    METADATA_AGENTS,
    METADATA_HIDDEN,
  ])
  const rest: Record<string, string> = {}
  for (const key of Object.keys(metadata)) {
    if (owned.has(key)) continue
    rest[key] = metadata[key]
  }
  return rest
}

const METADATA_CARDS = 'grid-cards'
const METADATA_AGENTS = 'grid-agents'
const METADATA_HIDDEN = 'grid-hidden'

const HIDDEN_TRUE = new Set(['true', '1', 'yes'])

function readHidden(metadata?: Record<string, string>): boolean {
  return HIDDEN_TRUE.has((metadata?.[METADATA_HIDDEN] ?? '').trim().toLowerCase())
}

export interface SkillPersistence {
  save: (input: CreateSkillInput & { categoryId?: string | null }, enabled: boolean) => Promise<void>
  remove?: () => Promise<void>
  switchLabels?: { label: string; hint: string }
  titles?: { create: string; edit: string; createSubtitle: string; editSubtitle: string }
  successMessage?: { create: string; edit: string }
  deleteCopy?: { title: string; description: string; confirm: string }
}

interface SkillEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillListItem | null
  persistence?: SkillPersistence
  categories?: SkillCategoryListItem[]
  onSaved: () => void
}

interface EditorValues {
  name: string
  description: string
  body: string
}

const STEP_KEYS = ['what', 'instructions', 'check'] as const
type StepKey = (typeof STEP_KEYS)[number]

const STEP_FOR_FIELD: Record<SkillReviewField, StepKey> = {
  name: 'what',
  description: 'what',
  body: 'instructions',
}

const CONTROL_ID: Record<SkillReviewField, string> = {
  name: 'name',
  description: 'description',
  body: 'skill-body',
}

export function SkillEditorDialog({
  open,
  onOpenChange,
  skill,
  persistence,
  categories = [],
  onSaved,
}: SkillEditorDialogProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  const isEdit = skill !== null
  const source: SkillListItem | null = skill
  const [preferredCards, setPreferredCards] = useState<string[]>(() =>
    parsePreferredCardTypes(source?.metadata[METADATA_CARDS]),
  )
  const [cardQuery, setCardQuery] = useState('')
  const [agents, setAgents] = useState<AgentScope>(() =>
    parseAgentScope(source?.metadata[METADATA_AGENTS]),
  )
  const [hidden, setHidden] = useState(() => readHidden(source?.metadata))
  const [extraMetadata, setExtraMetadata] = useState<Record<string, string>>(() =>
    source ? withoutReservedKeys(source.metadata) : {},
  )

  const buildMetadata = useCallback((): Record<string, string> => {
    const metadata: Record<string, string> = {}
    const scope = formatAgentScope(agents)
    if (scope) metadata[METADATA_AGENTS] = scope
    if (preferredCards.length > 0) {
      metadata[METADATA_CARDS] = formatPreferredCardTypes(preferredCards)
    }
    if (hidden) metadata[METADATA_HIDDEN] = 'true'
    return { ...metadata, ...extraMetadata }
  }, [agents, extraMetadata, hidden, preferredCards])
  const [enabled, setEnabled] = useState(isEdit ? skill.enabled : true)
  const [categoryId, setCategoryId] = useState<string | null>(source?.categoryId ?? null)
  const [stepIndex, setStepIndex] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const step: StepKey = STEP_KEYS[stepIndex] ?? 'what'
  const goToField = useCallback((field: SkillReviewField) => {
    setStepIndex(STEP_KEYS.indexOf(STEP_FOR_FIELD[field]))
    requestAnimationFrame(() => {
      document.getElementById(CONTROL_ID[field])?.focus()
    })
  }, [])

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(next, STEP_KEYS.length - 1))
    setStepIndex(clamped)
    setFurthest((seen) => Math.max(seen, clamped))
  }, [])

  const advancedSummary = [
    agents.selected.length < SKILL_AGENTS.length ? t('editor.agents.heading') : null,
    hidden ? t('editor.hiddenLabel') : null,
    categoryId ? t('editor.category.heading') : null,
    preferredCards.length > 0 ? t('editor.cards.heading') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const [formError, setFormError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const catalogByType = useMemo(
    () => new Map(CARD_CATALOG.map((entry) => [entry.type, entry])),
    [],
  )
  const cardResults = useMemo(
    () => searchCardCatalog(cardQuery).filter((entry) => !preferredCards.includes(entry.type)),
    [cardQuery, preferredCards],
  )
  const addCard = useCallback((type: string) => {
    setPreferredCards((current) => (current.includes(type) ? current : [...current, type]))
  }, [])
  const removeCard = useCallback((type: string) => {
    setPreferredCards((current) => current.filter((entry) => entry !== type))
  }, [])

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t('editor.nameRequired'))
          .max(64, t('editor.nameTooLong'))
          .regex(SKILL_NAME_PATTERN, t('editor.nameInvalid')),
        description: z
          .string()
          .trim()
          .min(1, t('editor.descriptionRequired'))
          .max(1024, t('editor.descriptionTooLong')),
        body: z
          .string()
          .trim()
          .min(1, t('editor.bodyRequired'))
          .max(32000, t('editor.bodyTooLong')),
      }),
    [t],
  )

  const form = useAppForm({
    defaultValues: {
      name: source?.name ?? '',
      description: source?.description ?? '',
      body: source?.body ?? '',
    } satisfies EditorValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const metadata = buildMetadata()

      const document = {
        name: value.name.trim(),
        description: value.description.trim(),
        body: value.body.trim(),
        metadata,
        enabled,
      }
      const payload: CreateSkillInput & { categoryId?: string | null } = isEdit
        ? { ...document, categoryId }
        : categoryId !== null
          ? { ...document, categoryId }
          : document

      try {
        if (persistence) {
          await persistence.save(payload, enabled)
          toast.success(
            isEdit
              ? (persistence.successMessage?.edit ?? t('editor.updateSuccess'))
              : (persistence.successMessage?.create ?? t('editor.createSuccess')),
          )
        } else if (isEdit) {
          await updateSkill(skill.id!, payload)
          toast.success(t('editor.updateSuccess'))
        } else {
          const { categoryId: unsorted, ...createPayload } = payload
          await createSkill(
            unsorted !== null && unsorted !== undefined
              ? { ...createPayload, categoryId: unsorted }
              : createPayload,
          )
          toast.success(t('editor.createSuccess'))
        }
        capturePosthog(isEdit ? 'skill_updated' : 'skill_created', {
          scope: persistence ? 'platform' : 'organization',
          enabled,
          hidden,
          preferred_card_count: preferredCards.length,
          agent_count: agents.selected.length,
        })
        onSaved()
      } catch {
        setFormError(t('editor.saveError'))
        toast.error(t('editor.saveError'))
      }
    },
  })

  const fieldsChanged = useStore(form.store, (state) => !state.isDefaultValue)
  const arrangement = JSON.stringify([preferredCards, agents, hidden, enabled, categoryId, extraMetadata])
  const openedWith = useRef(arrangement)
  const dirty = fieldsChanged || arrangement !== openedWith.current

  const requestClose = (): void => {
    if (form.state.isSubmitting) return
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(false)
  }

  const liveName = useStore(form.store, (state) => (state.values as EditorValues).name)
  const liveDescription = useStore(
    form.store,
    (state) => (state.values as EditorValues).description,
  )
  const liveBody = useStore(form.store, (state) => (state.values as EditorValues).body)
  const review = useSkillReview({
    name: liveName,
    description: liveDescription,
    body: liveBody,
  })

  const openOnStep = (key: StepKey): number =>
    review.stale
      ? 0
      : review.findings.filter((finding) => STEP_FOR_FIELD[finding.field] === key).length
  const steps = STEP_KEYS.map((key) => {
    const open = openOnStep(key)
    return {
      key,
      label: t(`editor.steps.${key}`),
      ...(open > 0 ? { note: t('editor.review.openCount', { count: open }) } : {}),
    }
  })


  const applyDocument = useCallback(
    (parsed: ParsedSkillDocument) => {
      form.setFieldValue('name', parsed.name)
      form.setFieldValue('description', parsed.description)
      form.setFieldValue('body', parsed.body)
      setPreferredCards(parsePreferredCardTypes(parsed.metadata[METADATA_CARDS]))
      setAgents(parseAgentScope(parsed.metadata[METADATA_AGENTS]))
      setHidden(readHidden(parsed.metadata))
      setExtraMetadata(withoutReservedKeys(parsed.metadata))
      toast.success(t('editor.raw.applied'))
    },
    [form, t],
  )

  const markdownLabels = useMemo<MarkdownEditorLabels>(
    () => ({
      h1: t('editor.markdown.h1'),
      h2: t('editor.markdown.h2'),
      h3: t('editor.markdown.h3'),
      bold: t('editor.markdown.bold'),
      italic: t('editor.markdown.italic'),
      code: t('editor.markdown.code'),
      codeBlock: t('editor.markdown.codeBlock'),
      bulletList: t('editor.markdown.bulletList'),
      numberedList: t('editor.markdown.numberedList'),
      taskList: t('editor.markdown.taskList'),
      link: t('editor.markdown.link'),
      quote: t('editor.markdown.quote'),
      table: t('editor.markdown.table'),
      edit: t('editor.markdown.edit'),
      split: t('editor.markdown.split'),
      preview: t('editor.markdown.preview'),
      fullscreen: t('editor.markdown.fullscreen'),
    }),
    [t],
  )

  const canDelete = isEdit && (persistence ? Boolean(persistence.remove) : true)

  const confirmDelete = async () => {
    if (!skill) return
    setDeleting(true)
    try {
      if (persistence?.remove) await persistence.remove()
      else await deleteSkill(skill.id!)
      capturePosthog('skill_deleted', { scope: persistence ? 'platform' : 'organization' })
      setConfirmOpen(false)
      onSaved()
    } catch {
      toast.error(t('editor.saveError'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else requestClose()
        }}
      >
        {/* A reading column, not a page.

            This used to be a `sm:max-w-5xl` two-column form: the document on
            the left, a rail of eight settings on the right, everything at once.
            It asked an author to hold the whole skill in their head before
            they had written a line of it, and the rail — agents, cards,
            category, two switches — sat at the same weight as the description,
            which is the ONE field that decides whether the skill is ever
            picked.

            It is a stepped form now, the same shape and the same `Stepper` the
            task builder wears, because it asks the same kind of thing: a short
            sequence of questions where knowing how many are left is what
            decides whether somebody finishes. Everything that is not the
            document is behind one „Erweitert" on the last step. */}
        <DialogContent
          fullScreenOnMobile
          className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 phone:pt-[env(safe-area-inset-top)] phone:pb-[env(safe-area-inset-bottom)] sm:max-w-2xl"
        >
          <DialogHeader className="border-border shrink-0 border-b px-6 py-5 pr-14">
            <DialogTitle>
              {isEdit
                ? (persistence?.titles?.edit ?? t('editor.editTitle'))
                : (persistence?.titles?.create ?? t('editor.createTitle'))}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? (persistence?.titles?.editSubtitle ?? t('editor.editSubtitle'))
                : (persistence?.titles?.createSubtitle ?? t('editor.createSubtitle'))}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-6">
                <Stepper
                  steps={steps}
                  current={stepIndex}
                  furthest={furthest}
                  onSelect={goTo}
                  label={t('editor.steps.label')}
                  progressLabel={t('editor.steps.progress', {
                    current: stepIndex + 1,
                    total: STEP_KEYS.length,
                  })}
                />

                <div className="min-h-[24rem]">
                  {step === 'what' && (
                    <section data-testid="skill-step-what">
                      <StepHeading
                        title={t('editor.steps.whatTitle')}
                        hint={t('editor.steps.whatHint')}
                      />
                      <div className="flex flex-col gap-5">
                        <form.AppField name="name">
                          {(field) => (
                            <field.TextField
                              label={t('editor.nameLabel')}
                              placeholder={t('editor.namePlaceholder')}
                              description={t('editor.nameHint')}
                              required
                              className="font-mono"
                            />
                          )}
                        </form.AppField>
                        {/* The reviewer's findings about THIS field, under it. The
                            critique belongs beside the thing criticised: an author revising
                            the name should not have to walk two steps back carrying the
                            advice in their head. */}
                        <SkillFindingList
                          findings={review.findingsFor('name')}
                          variant="inline"
                          stale={review.stale}
                          data-testid="skill-findings-name"
                        />
                        {/* The description is not a caption. It is the ONLY
                            thing an agent reads before deciding whether to load
                            the skill, so it gets its own step beside the name
                            and nothing else competes with it. */}
                        <form.AppField name="description">
                          {(field) => (
                            <div className="flex flex-col gap-1.5">
                              <field.TextAreaField
                                label={t('editor.descriptionLabel')}
                                placeholder={t('editor.descriptionPlaceholder')}
                                required
                                rows={3}
                              />
                              <div className="flex items-start justify-between gap-4">
                                <p className="text-muted-foreground text-xs leading-snug">
                                  {t('editor.descriptionHint')}
                                </p>
                                <span
                                  className={cn(
                                    'shrink-0 text-xs tabular-nums',
                                    (field.state.value ?? '').length > DESCRIPTION_MAX
                                      ? 'text-destructive'
                                      : 'text-muted-foreground',
                                  )}
                                >
                                  {(field.state.value ?? '').length}/{DESCRIPTION_MAX}
                                </span>
                              </div>
                            </div>
                          )}
                        </form.AppField>
                        {/* The reviewer's findings about THIS field, under it. The
                            critique belongs beside the thing criticised: an author revising
                            the description should not have to walk two steps back carrying the
                            advice in their head. */}
                        <SkillFindingList
                          findings={review.findingsFor('description')}
                          variant="inline"
                          stale={review.stale}
                          data-testid="skill-findings-description"
                        />
                      </div>
                    </section>
                  )}

                  {step === 'instructions' && (
                    <section data-testid="skill-step-instructions">
                      <StepHeading
                        title={t('editor.steps.instructionsTitle')}
                        hint={t('editor.steps.instructionsHint')}
                      />
                    <form.AppField name="body">
                      {(field) => {
                        const errors = field.state.meta.isTouched
                          ? (field.state.meta.errors as Array<string | { message: string } | undefined>)
                          : []
                        return (
                          <FieldShell
                            label={t('editor.bodyLabel')}
                            description={t('editor.bodyHint')}
                            required
                            htmlFor="skill-body"
                            errors={errors}
                          >
                            <MarkdownEditor
                              id="skill-body"
                              value={field.state.value ?? ''}
                              onChange={field.handleChange}
                              onBlur={field.handleBlur}
                              placeholder={t('editor.bodyPlaceholder')}
                              invalid={errors.length > 0}
                              labels={markdownLabels}
                            />
                          </FieldShell>
                        )
                      }}
                    </form.AppField>
                    {/* The reviewer's findings about THIS field, under it. The
                        critique belongs beside the thing criticised: an author revising
                        the instructions should not have to walk two steps back carrying the
                        advice in their head. */}
                    <SkillFindingList
                      findings={review.findingsFor('body')}
                      variant="inline"
                      stale={review.stale}
                      data-testid="skill-findings-body"
                    />
                      <form.Subscribe selector={(state) => state.values}>
                        {(values) => (
                          <SkillRawDocumentSection
                            document={renderSkillDocument({
                              name: values.name,
                              description: values.description,
                              body: values.body,
                              metadata: buildMetadata(),
                            })}
                            onApply={applyDocument}
                          />
                        )}
                      </form.Subscribe>
                    </section>
                  )}

                  {step === 'check' && (
                    <section data-testid="skill-step-check">
                      <StepHeading
                        title={t('editor.steps.checkTitle')}
                        hint={t('editor.steps.checkHint')}
                      />
                      <form.Subscribe selector={(state) => state.values}>
                        {(values) => (
                          <div className="flex flex-col gap-5">
                            {/* The check is the step. Running it is what opens
                                the save; what it finds is the author's to
                                weigh. */}
                            <SkillReviewPanel
                              state={review.state}
                              stale={review.stale}
                              findings={review.findings}
                              onRun={() => void review.run()}
                              onGoToField={goToField}
                            />
                            <SkillDocumentPreview
                              name={values.name}
                              description={values.description}
                              body={values.body}
                              metadata={buildMetadata()}
                            />
                            <Advanced
                              label={t('editor.steps.advanced')}
                              summary={advancedSummary || null}
                              data-testid="skill-advanced"
                            >
                            <section className="border-border flex flex-col gap-4 rounded-xl border p-4">
                              <div className="flex flex-col gap-0.5">
                                <h3 className="text-sm font-medium">{t('editor.agents.heading')}</h3>
                                <p className="text-muted-foreground text-xs">{t('editor.agents.hint')}</p>
                              </div>

                              <div className="flex flex-col gap-2.5">
                                {SKILL_AGENTS.map((agent) => {
                                  const checked = agents.selected.includes(agent)
                                  const last = checked && agents.selected.length === 1
                                  const key = agent === 'researcher' ? 'chat' : 'deep'
                                  return (
                                    <Field
                                      key={agent}
                                      orientation="horizontal"
                                      className="justify-start gap-2.5"
                                    >
                                      <Checkbox
                                        id={`skill-agent-${agent}`}
                                        checked={checked}
                                        disabled={last}
                                        onCheckedChange={(next) =>
                                          setAgents((current) => ({
                                            ...current,
                                            selected:
                                              next === true
                                                ? SKILL_AGENTS.filter(
                                                    (name) =>
                                                      name === agent || current.selected.includes(name),
                                                  )
                                                : current.selected.filter((name) => name !== agent),
                                          }))
                                        }
                                        className="mt-0.5"
                                      />
                                      <div className="flex min-w-0 flex-col gap-0.5">
                                        <FieldLabel
                                          htmlFor={`skill-agent-${agent}`}
                                          className="font-medium"
                                        >
                                          {t(`editor.agents.${key}.label`)}
                                        </FieldLabel>
                                        <FieldDescription className="leading-snug">
                                          {t(`editor.agents.${key}.hint`)}
                                        </FieldDescription>
                                      </div>
                                    </Field>
                                  )
                                })}
                              </div>
                              <Field orientation="horizontal">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <FieldLabel htmlFor="skill-hidden">{t('editor.hiddenLabel')}</FieldLabel>
                                  <FieldDescription>{t('editor.hiddenHint')}</FieldDescription>
                                </div>
                                <Switch id="skill-hidden" checked={hidden} onCheckedChange={setHidden} />
                              </Field>

                              <Field orientation="horizontal">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <FieldLabel htmlFor="skill-enabled">
                                    {persistence?.switchLabels?.label ?? t('editor.enabledLabel')}
                                  </FieldLabel>
                                  <FieldDescription>
                                    {persistence?.switchLabels?.hint ?? t('editor.enabledHint')}
                                  </FieldDescription>
                                </div>
                                <Switch id="skill-enabled" checked={enabled} onCheckedChange={setEnabled} />
                              </Field>
                              </section>
                            <section className="border-border flex flex-col gap-2 rounded-xl border p-4">
                              <div className="flex flex-col gap-0.5">
                                <h3 className="text-sm font-medium">{t('editor.category.heading')}</h3>
                                <p className="text-muted-foreground text-xs">{t('editor.category.hint')}</p>
                              </div>
                              <Field>
                                <FieldLabel htmlFor="skill-category">{t('editor.category.label')}</FieldLabel>
                                <Select
                                  value={categoryId ?? '__unsorted__'}
                                  onValueChange={(next) => setCategoryId(next === '__unsorted__' ? null : next)}
                                >
                                  <SelectTrigger id="skill-category">
                                    <SelectValue placeholder={t('editor.category.unsorted')} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__unsorted__">{t('editor.category.unsorted')}</SelectItem>
                                    {categories.map((category) => (
                                      <SelectItem key={category.id} value={category.id}>
                                        {category.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                            </section>
                            <section className="border-border flex flex-col gap-2 rounded-xl border p-4">
                              <div className="flex flex-col gap-0.5">
                                <h3 className="text-sm font-medium">{t('editor.cards.heading')}</h3>
                                <p className="text-muted-foreground text-xs">{t('editor.cards.hint')}</p>
                              </div>

                              {preferredCards.length === 0 ? (
                                <EmptyState variant="bare" title={t('editor.cards.empty')} className="py-3" />
                              ) : (
                                <ul className="flex flex-col gap-1.5">
                                  {preferredCards.map((type) => (
                                    <li key={type} className="flex flex-col items-start gap-0.5">
                                      <Chip variant="secondary" size="sm">
                                        <span className="font-mono">{type}</span>
                                        <button
                                          type="button"
                                          aria-label={t('editor.cards.removeAria', { type })}
                                          onClick={() => removeCard(type)}
                                          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mr-0.5 rounded-sm leading-none transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2"
                                        >
                                          <X className="size-3" aria-hidden />
                                        </button>
                                      </Chip>
                                      <span className="text-muted-foreground text-xs">
                                        {catalogByType.get(type)?.description}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <SearchField
                                type="text"
                                value={cardQuery}
                                onChange={setCardQuery}
                                placeholder={t('editor.cards.searchPlaceholder')}
                                label={t('editor.cards.searchPlaceholder')}
                              />

                              <div className="h-44">
                                {cardResults.length === 0 ? (
                                  <EmptyState
                                    variant="bare"
                                    title={t('editor.cards.noMatches')}
                                    className="flex h-full items-center py-3"
                                  />
                                ) : (
                                  <ScrollArea className="h-full">
                                    <ItemList>
                                      {cardResults.map((entry) => (
                                        <Item key={entry.type} asChild>
                                          <button type="button" onClick={() => addCard(entry.type)}>
                                            <ItemContent>
                                              <ItemTitle className="font-mono">{entry.type}</ItemTitle>
                                              <ItemDescription>{entry.description}</ItemDescription>
                                            </ItemContent>
                                          </button>
                                        </Item>
                                      ))}
                                    </ItemList>
                                  </ScrollArea>
                                )}
                              </div>
                            </section>
                            </Advanced>
                          </div>
                        )}
                      </form.Subscribe>
                    </section>
                  )}
                </div>
              </div>
            </div>

            <div className="border-border bg-popover shrink-0 border-t px-6 py-4">
              {formError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              {/* Back / Weiter, and Speichern only on the last step — the task
                  builder's nav, because this is the same kind of form.
                  „Weiter" never validates: a stepped form that refuses to move
                  on is one people answer defensively, and every field is
                  validated on the save anyway. */}
              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => (stepIndex === 0 ? requestClose() : goTo(stepIndex - 1))}
                  data-testid="skill-back"
                >
                  {stepIndex === 0 ? t('editor.cancel') : t('editor.steps.back')}
                </Button>
                {step !== 'check' ? (
                  <Button type="button" onClick={() => goTo(stepIndex + 1)} data-testid="skill-next">
                    {t('editor.steps.next')}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
              {canDelete && (
                <Button
                  type="button"
                  variant="secondary"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  {t('actions.delete')}
                </Button>
              )}
              <form.Subscribe
                selector={(state) => [state.canSubmit, state.isSubmitting] as const}
              >
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    disabled={!canSubmit || isSubmitting || !review.gate.checked}
                    aria-busy={isSubmitting}
                    aria-describedby={review.gate.checked ? undefined : 'skill-review-required'}
                  >
                    <span className="inline-grid justify-items-start">
                      <span
                        className={cn(
                          'col-start-1 row-start-1 inline-flex items-center gap-2',
                          isSubmitting && 'invisible',
                        )}
                        aria-hidden={isSubmitting}
                      >
                        {t('editor.save')}
                      </span>
                      <span
                        className={cn(
                          'col-start-1 row-start-1 inline-flex items-center gap-2',
                          !isSubmitting && 'invisible',
                        )}
                        aria-hidden={!isSubmitting}
                      >
                        <Spinner size="sm" aria-hidden />
                        {t('editor.saving')}
                      </span>
                    </span>
                  </Button>
                )}
              </form.Subscribe>
                  </div>
                )}
              </DialogFooter>
              {step === 'check' && !review.gate.checked && (
                <p
                  id="skill-review-required"
                  className="text-muted-foreground mt-2 text-right text-xs"
                  data-testid="skill-review-required"
                >
                  {t('editor.review.required')}
                </p>
              )}
            </div>

          </form>
        </DialogContent>
      </Dialog>

      {/* Closing with unsaved work. Stacked over the editor on purpose: the
          editor stays mounted and keeps every field while the question is open,
          so "Weiter bearbeiten" costs nothing. */}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="warning"
        title={t('editor.discardTitle')}
        description={t('editor.discardBody')}
        confirmLabel={t('editor.discardConfirm')}
        cancelLabel={t('editor.discardKeep')}
        onConfirm={() => {
          setDiscardOpen(false)
          onOpenChange(false)
        }}
      />

      {/* Edit-mode delete: removes the skill from the toolbox; schedules keep
          their saved snapshot, so they keep running unchanged. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="destructive"
        title={persistence?.deleteCopy?.title ?? t('editor.deleteTitle')}
        description={
          persistence?.deleteCopy?.description ??
          t('editor.deleteDescription', { name: skill?.name ?? '' })
        }
        confirmLabel={persistence?.deleteCopy?.confirm ?? t('editor.deleteConfirm')}
        cancelLabel={t('editor.cancel')}
        pending={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </>
  )
}
