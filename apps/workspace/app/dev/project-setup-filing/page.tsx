'use client'

import { use, useMemo, useState } from 'react'
import { useFakeProposalClient } from '@/app/dev/_fixtures/fake-proposals'
import { INTAKE_FILING, INTAKE_READY, INTAKE_WAITING } from '@/app/dev/_fixtures/project-intake'
import {
  FILING_FOLDERS_UPLOADED,
  FILING_PROJECT_FOLDER,
  FILING_SCREENING,
  FILING_SCREENING_CHANGED,
  FILING_SCREENING_READONLY,
  fakeFilingClient,
} from '@/app/dev/_fixtures/project-setup-filing'
import { useFilingSuggestions } from '@/features/documents/hooks/use-filing-suggestions'
import {
  SetupBar,
  SetupFooter,
  StepFooterProvider,
  useStepFooterChannel,
} from '@/features/project-intake/components/setup-frame'
import { FilingStep } from '@/features/project-intake/components/steps/filing-step'
import type { SetupStepSummary } from '@/features/project-intake/components/steps/types'

const STATES = ['empty', 'chosen', 'changed', 'readonly', 'listfailed', 'uploading', 'uploaded'] as const
type State = (typeof STATES)[number]

function stateOf(value: string | string[] | undefined): State {
  const name = Array.isArray(value) ? value[0] : value
  return (STATES as readonly string[]).includes(name ?? '') ? (name as State) : 'chosen'
}

const SUMMARIES: SetupStepSummary[] = [
  { id: 'project', open: false },
  { id: 'filing', open: true },
  { id: 'reading', open: false },
  { id: 'questions', open: false },
  { id: 'profile', open: false },
]

export default function ProjectSetupFilingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const state = stateOf(use(searchParams).state)
  const uploaded = state === 'uploaded'
  const view = uploaded ? INTAKE_READY : INTAKE_WAITING
  const client = useMemo(() => {
    const screening =
      state === 'changed' ? FILING_SCREENING_CHANGED : state === 'readonly' ? FILING_SCREENING_READONLY : FILING_SCREENING
    const fake = fakeFilingClient(screening, uploaded ? FILING_FOLDERS_UPLOADED : [])
    if (state === 'listfailed') fake.loadScreening = () => Promise.reject(new Error('fixture: list unavailable'))
    return fake
  }, [state, uploaded])
  const [sent, setSent] = useState<string | null>(null)
  const proposalsReady = useFakeProposalClient(INTAKE_FILING)
  const filing = useFilingSuggestions({
    query: proposalsReady && uploaded ? { projectId: view.projectId } : null,
    watching: false,
  })
  const footer = useStepFooterChannel()
  const chosen = state === 'chosen' || state === 'changed' || state === 'readonly' || state === 'listfailed'

  return (
    <StepFooterProvider value={footer.channel}>
      <div className="bg-background flex h-dvh min-h-0 flex-col" data-testid="project-setup-filing-preview">
        <SetupBar
          projectId={view.projectId}
          projectName="Aufstockung Lacknergasse"
          step="filing"
          summaries={SUMMARIES}
          progress={footer.progress ?? undefined}
          onGoTo={(step) => setSent(`onGoTo: ${step}`)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 md:px-8 md:pt-9">
          <FilingStep
            key={state}
            view={view}
            projectId={view.projectId}
            busy={false}
            canDecide
            canUpload
            uploading={state === 'uploading'}
            onDecide={async () => true}
            onFiles={(files) =>
              setSent(`onFiles: ${files.length} files\n${files.map((file) => file.webkitRelativePath || file.name).join('\n')}`)
            }
            onReread={() => undefined}
            onNext={() => setSent('onNext')}
            onGoTo={(step) => setSent(`onGoTo: ${step}`)}
            filing={uploaded ? { entries: filing.byFolder, onSettled: filing.reload } : undefined}
            client={client}
            initialChoice={chosen ? FILING_PROJECT_FOLDER : undefined}
          />
        </main>
        <SetupFooter
          step="filing"
          progress={footer.progress}
          ownsPrimary={footer.ownsPrimary}
          slotRef={footer.slotRef}
          onNext={() => setSent('onNext')}
        />
        {sent && (
          <pre className="bg-card text-muted-foreground fixed bottom-24 left-4 z-50 max-h-40 max-w-md overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 font-mono text-xs shadow">
            {sent}
          </pre>
        )}
      </div>
    </StepFooterProvider>
  )
}
