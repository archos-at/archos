'use client'

import type { JSX } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { toast } from 'sonner'
import { FieldShell, useAppForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Stepper } from '@/components/ui/stepper'
import { Advanced, StepHeading } from '@/components/ui/step-form'
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
import { SkillFindingList } from './SkillFindingList'
import { SkillReviewPanel } from './SkillReviewPanel'
import { useSkillReview, type SkillReviewField } from '../hooks/use-skill-review'
import { capturePosthog } from '@/lib/analytics/posthog'
import { readMetadata, writtenMetadataKey } from '@/lib/skills/legacy-names'
import {
  METADATA_AGENTS,
  METADATA_CARDS,
  METADATA_HIDDEN,
  readHidden,
  withoutReservedKeys,
} from '../lib/skill-editor-metadata'
import {
  buildSkillEditorSchema,
  DESCRIPTION_MAX,
  type EditorValues,
} from '../lib/skill-editor-schema'
import { CONTROL_ID, STEP_FOR_FIELD, STEP_KEYS, type StepKey } from '../lib/skill-editor-steps'
import { buildMarkdownLabels } from '../lib/markdown-editor-labels'
import type { SkillPersistence } from '../lib/skill-persistence'
import { SkillAvailabilitySection } from './skill-editor-dialog/availability-section'
import { SkillCategorySection } from './skill-editor-dialog/category-section'
import { SkillPreferredCardsSection } from './skill-editor-dialog/preferred-cards-section'
import { SkillEditorFooter } from './skill-editor-dialog/footer'
import { SkillEditorConfirmDialogs } from './skill-editor-dialog/confirm-dialogs'
import { SkillEditorHeader } from './skill-editor-dialog/header'

export type { SkillPersistence } from '../lib/skill-persistence'

interface SkillEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillListItem | null
  persistence?: SkillPersistence
  categories?: SkillCategoryListItem[]
  onSaved: () => void
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
    parsePreferredCardTypes(source ? readMetadata(source.metadata, METADATA_CARDS) : undefined),
  )
  const [cardQuery, setCardQuery] = useState('')
  const [agents, setAgents] = useState<AgentScope>(() =>
    parseAgentScope(source ? readMetadata(source.metadata, METADATA_AGENTS) : undefined),
  )
  const [hidden, setHidden] = useState(() => readHidden(source?.metadata))
  const [extraMetadata, setExtraMetadata] = useState<Record<string, string>>(() =>
    source ? withoutReservedKeys(source.metadata) : {},
  )

  const buildMetadata = useCallback((): Record<string, string> => {
    const metadata: Record<string, string> = {}
    const scope = formatAgentScope(agents)
    if (scope) metadata[writtenMetadataKey(METADATA_AGENTS)] = scope
    if (preferredCards.length > 0) {
      metadata[writtenMetadataKey(METADATA_CARDS)] = formatPreferredCardTypes(preferredCards)
    }
    if (hidden) metadata[writtenMetadataKey(METADATA_HIDDEN)] = 'true'
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

  const schema = useMemo(() => buildSkillEditorSchema(t), [t])

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
      setPreferredCards(parsePreferredCardTypes(readMetadata(parsed.metadata, METADATA_CARDS)))
      setAgents(parseAgentScope(readMetadata(parsed.metadata, METADATA_AGENTS)))
      setHidden(readHidden(parsed.metadata))
      setExtraMetadata(withoutReservedKeys(parsed.metadata))
      toast.success(t('editor.raw.applied'))
    },
    [form, t],
  )

  const markdownLabels = useMemo<MarkdownEditorLabels>(() => buildMarkdownLabels(t), [t])

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

  const saveButton = (
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
  )

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
          <SkillEditorHeader isEdit={isEdit} persistence={persistence} />

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
                              <SkillAvailabilitySection
                                agents={agents}
                                setAgents={setAgents}
                                hidden={hidden}
                                setHidden={setHidden}
                                enabled={enabled}
                                setEnabled={setEnabled}
                                persistence={persistence}
                              />
                              <SkillCategorySection
                                categoryId={categoryId}
                                setCategoryId={setCategoryId}
                                categories={categories}
                              />
                              <SkillPreferredCardsSection
                                preferredCards={preferredCards}
                                cardQuery={cardQuery}
                                setCardQuery={setCardQuery}
                                cardResults={cardResults}
                                catalogByType={catalogByType}
                                addCard={addCard}
                                removeCard={removeCard}
                              />
                            </Advanced>
                          </div>
                        )}
                      </form.Subscribe>
                    </section>
                  )}
                </div>
              </div>
            </div>

            <SkillEditorFooter
              formError={formError}
              step={step}
              stepIndex={stepIndex}
              canDelete={canDelete}
              reviewChecked={review.gate.checked}
              saveButton={saveButton}
              onBack={() => (stepIndex === 0 ? requestClose() : goTo(stepIndex - 1))}
              onNext={() => goTo(stepIndex + 1)}
              onDelete={() => setConfirmOpen(true)}
            />
          </form>
        </DialogContent>
      </Dialog>

      <SkillEditorConfirmDialogs
        discardOpen={discardOpen}
        setDiscardOpen={setDiscardOpen}
        onDiscard={() => {
          setDiscardOpen(false)
          onOpenChange(false)
        }}
        confirmOpen={confirmOpen}
        setConfirmOpen={setConfirmOpen}
        deleting={deleting}
        skillName={skill?.name ?? ''}
        persistence={persistence}
        onConfirmDelete={() => void confirmDelete()}
      />
    </>
  )
}
