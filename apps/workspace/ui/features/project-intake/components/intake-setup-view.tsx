'use client'

import type { JSX, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Info, RefreshCw, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import {
  FileDropOverlay,
  useWindowDragGuard,
} from '@/features/documents/components/file-drop-overlay'
import { useFileDragDrop, type DropInfo } from '@/features/documents/hooks/use-file-drag-drop'
import type { FilingFolderSuggestion } from '@/features/documents/lib/filing-suggestions'
import { useTranslations, type Translator } from '@/i18n'
import { intakeShellCopy } from '@/i18n/namespaces/intake-shell'
import { projectIntakeCopy } from '@/i18n/namespaces/project-intake'
import type { IntakeDecision, IntakeView } from '@/lib/project-intake/types'
import { usePressed } from '../hooks/use-pressed'
import { CompletedNote } from './completed-note'
import { EvidenceProjectContext } from './evidence-chips'
import { SetupBar, SetupFooter, StepFooterProvider, useStepFooterChannel } from './setup-frame'
import { FilingStep } from './steps/filing-step'
import { ProfileStep } from './steps/profile-step'
import { ProjectStep } from './steps/project-step'
import type { ParticipantsClient } from '@/lib/projects/participants-client'
import { QuestionsStep } from './steps/questions-step'
import { questionRound } from '../lib/question-round'
import { ReadingStep } from './steps/reading-step'
import {
  SETUP_STEP_IDS,
  isSetupStepId,
  type SetupStepId,
  type SetupStepProps,
  type SetupStepSummary,
} from './steps/types'

export interface IntakeSetupViewProps {
  view: IntakeView
  projectId: string
  projectName?: string
  busy: boolean
  stale: boolean
  canUpload: boolean
  uploading: boolean
  onFiles: (files: File[], info?: DropInfo) => void
  onDecide: (decisions: IntakeDecision[]) => Promise<boolean>
  onReread: () => void | Promise<void>
  onComplete: () => Promise<boolean>
  onRetry: () => void
  filing?: { entries: readonly FilingFolderSuggestion[]; onSettled: () => void }
  children?: ReactNode
  participantsClient?: ParticipantsClient
}

export const SETUP_STEP_PARAM = 'step'

function hasNoDocuments(view: IntakeView): boolean {
  return view.counts.documentsRead + view.counts.unreadDocuments === 0
}

function hasFoundNothing(view: IntakeView): boolean {
  return view.counts.suggested === 0 && view.groups.every((group) => group.items.length === 0)
}

export function defaultSetupStep(view: IntakeView): SetupStepId {
  if (view.status === 'completed') return 'profile'
  if (hasNoDocuments(view)) return 'filing'
  if (view.status !== 'ready' && hasFoundNothing(view)) return 'reading'
  if (questionRound(view).openIds.length > 0) return 'questions'
  return 'profile'
}

export function setupStepSummaries(view: IntakeView, tShell: Translator): SetupStepSummary[] {
  const { counts } = view
  const total = counts.documentsRead + counts.unreadDocuments
  const finished = view.status === 'completed'
  const readingNote = (): string | undefined => {
    if (view.status === 'reading') {
      const { documentsOpened, documentsTotal } = view.readingProgress
      return tShell('notes.readOf', { read: documentsOpened, total: documentsTotal })
    }
    if (view.status === 'failed') return tShell('notes.failed')
    return counts.documentsRead > 0 ? tShell('notes.read', { count: counts.documentsRead }) : undefined
  }
  const openQuestions = finished ? 0 : questionRound(view).openIds.length
  const profileNote = (): string | undefined => {
    if (finished) return tShell('notes.done')
    return counts.suggested > 0 ? tShell('notes.values', { count: counts.suggested }) : undefined
  }
  return [
    { id: 'project', open: false },
    {
      id: 'filing',
      note: total > 0 ? tShell('notes.documents', { count: total }) : undefined,
      open: total === 0 && !finished,
    },
    { id: 'reading', note: readingNote(), open: false },
    {
      id: 'questions',
      note: openQuestions > 0 ? tShell('notes.open', { count: openQuestions }) : undefined,
      open: openQuestions > 0,
    },
    {
      id: 'profile',
      note: profileNote(),
      open: !finished && counts.suggested > 0,
    },
  ]
}

function useSetupStep(view: IntakeView): [SetupStepId, (next: SetupStepId) => void] {
  const searchParams = useSearchParams()
  const fromUrl = searchParams?.get(SETUP_STEP_PARAM)
  const [fallback] = useState<SetupStepId>(() => defaultSetupStep(view))
  const step = isSetupStepId(fromUrl) ? fromUrl : fallback
  const go = (next: SetupStepId): void => {
    if (next === step) return
    const url = new URL(window.location.href)
    url.searchParams.set(SETUP_STEP_PARAM, next)
    url.searchParams.delete('drop')
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return [step, go]
}

export function IntakeSetupView({
  view,
  projectId,
  projectName,
  busy,
  stale,
  canUpload,
  uploading,
  onFiles,
  onDecide,
  onReread,
  onComplete,
  onRetry,
  filing,
  children,
  participantsClient,
}: IntakeSetupViewProps): JSX.Element {
  const tShell = useTranslations(intakeShellCopy)
  const t = useTranslations(projectIntakeCopy)
  const finished = view.status === 'completed'
  const dropping = canUpload && !finished
  const [step, go] = useSetupStep(view)
  const { isDragging, isUnsupportedDrag, dragHandlers } = useFileDragDrop({
    onDrop: onFiles,
    disabled: !dropping || step === 'filing',
    acceptZip: true,
  })
  useWindowDragGuard()
  const top = useRef<HTMLElement>(null)
  const footer = useStepFooterChannel()
  const shown = useRef(step)
  useEffect(() => {
    if (shown.current === step) return
    shown.current = step
    top.current?.scrollTo?.({ top: 0 })
  }, [step])

  const failedElsewhere = view.status === 'failed' && step !== 'reading'
  const index = SETUP_STEP_IDS.indexOf(step)
  const next = SETUP_STEP_IDS[index + 1]
  const summaries = setupStepSummaries(view, tShell)
  const stepProps: SetupStepProps = {
    view,
    projectId,
    busy,
    canDecide: view.canDecide && !finished,
    canUpload: dropping,
    uploading,
    onDecide,
    onFiles,
    onReread,
    onNext: next ? () => go(next) : undefined,
    onGoTo: go,
  }

  return (
    <EvidenceProjectContext.Provider value={projectId}>
      <StepFooterProvider value={footer.channel}>
        <div
          className="bg-background relative flex h-full min-h-0 flex-col"
          data-testid="intake-setup"
          data-status={view.status}
          data-step={step}
          {...dragHandlers}
        >
          <FileDropOverlay
            show={isDragging}
            isUnsupported={isUnsupportedDrag}
            uploadLabel={t('upload.dropOverlay')}
            unsupportedLabel={t('upload.unsupportedOverlay')}
            testId="intake-drop-overlay"
          />

          <SetupBar
            projectId={projectId}
            projectName={projectName}
            step={step}
            summaries={summaries}
            progress={footer.progress ?? undefined}
            onGoTo={go}
          />

          <main
            ref={top}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 md:px-8 md:pt-9"
            aria-label={tShell(`steps.${step}`)}
          >
            {(stale || (!view.canDecide && !finished) || finished || failedElsewhere) && (
              <div className="mx-auto mb-6 w-full max-w-[1040px] space-y-3">
                {stale && (
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden />
                    <AlertDescription className="text-current">
                      <p>{t('errors.load')}</p>
                      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
                        {t('errors.retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {!view.canDecide && !finished && (
                  <Alert role="status">
                    <Info aria-hidden />
                    <AlertDescription>{t('header.readOnly')}</AlertDescription>
                  </Alert>
                )}
                {finished && <CompletedNote view={view} />}
                {failedElsewhere && (
                  <FailedReading canRetry={view.canDecide} busy={busy} onReread={onReread} />
                )}
              </div>
            )}

            {step === 'project' && <ProjectStep {...stepProps} client={participantsClient} />}
            {step === 'filing' && (
              <FilingStep {...stepProps} filing={filing}>
                {children}
              </FilingStep>
            )}
            {step === 'reading' && <ReadingStep {...stepProps} />}
            {step === 'questions' && <QuestionsStep {...stepProps} />}
            {step === 'profile' && <ProfileStep {...stepProps} onComplete={onComplete} />}
          </main>

          <SetupFooter
            step={step}
            progress={footer.progress}
            ownsPrimary={footer.ownsPrimary}
            slotRef={footer.slotRef}
            onNext={stepProps.onNext}
          />
        </div>
      </StepFooterProvider>
    </EvidenceProjectContext.Provider>
  )
}

function FailedReading({
  canRetry,
  busy,
  onReread,
}: {
  canRetry: boolean
  busy: boolean
  onReread: () => void | Promise<void>
}): JSX.Element {
  const t = useTranslations(projectIntakeCopy)
  const [retrying, retry] = usePressed()
  return (
    <Alert variant="destructive" data-testid="intake-failed">
      <TriangleAlert aria-hidden />
      <AlertTitle>{t('header.failedTitle')}</AlertTitle>
      <AlertDescription>
        <p>{t('header.failed')}</p>
        {canRetry && (
          <BusyButton
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            icon={<RefreshCw aria-hidden />}
            busy={retrying}
            blocked={busy}
            busyLabel={t('busy.reread')}
            aria-label={t('header.retryAria')}
            onClick={() => retry(async () => onReread())}
          >
            {t('header.reread')}
          </BusyButton>
        )}
      </AlertDescription>
    </Alert>
  )
}
