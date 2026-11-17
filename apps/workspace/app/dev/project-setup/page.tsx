'use client'

import { use, useMemo, useState } from 'react'
import { useFakeProposalClient } from '@/app/dev/_fixtures/fake-proposals'
import {
  INTAKE_FILING,
  INTAKE_FILING_STATES,
  INTAKE_FIXTURES,
  INTAKE_REGISTER,
  type IntakeFixtureName,
} from '@/app/dev/_fixtures/project-intake'
import { installFixtureDocuments } from './fixture-documents'
import { IntakeSetupView } from '@/features/project-intake/components/intake-setup-view'
import {
  createFixtureParticipantsClient,
  isProjectStepState,
} from '@/app/dev/_fixtures/project-setup-project'
import {
  PROFILE_STEP_FIXTURES,
  type ProfileStepFixtureName,
} from '@/app/dev/_fixtures/project-setup-profile'
import { QUESTIONS_FIXTURES } from '@/app/dev/_fixtures/project-setup-questions'
import { READING_FIXTURES } from '@/app/dev/_fixtures/project-setup-reading'
import { useFilingSuggestions } from '@/features/documents/hooks/use-filing-suggestions'
import type { IntakeDecision } from '@/lib/project-intake/types'

installFixtureDocuments(INTAKE_FIXTURES.ready)

const FIXTURE_PROJECT_NAME = 'Aufstockung Lacknergasse'

function stateOf(value: string | string[] | undefined): IntakeFixtureName {
  const name = Array.isArray(value) ? value[0] : value
  return name && name in INTAKE_FIXTURES ? (name as IntakeFixtureName) : 'ready'
}

export default function ProjectSetupPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = use(searchParams)
  const name = stateOf(params.state)
  const busy = params.busy === '1'
  const profileName =
    typeof params.profile === 'string' && params.profile in PROFILE_STEP_FIXTURES
      ? (params.profile as ProfileStepFixtureName)
      : null
  const questionsName =
    typeof params.questions === 'string' && params.questions in QUESTIONS_FIXTURES
      ? (params.questions as keyof typeof QUESTIONS_FIXTURES)
      : null
  const readingName =
    typeof params.reading === 'string' && params.reading in READING_FIXTURES
      ? (params.reading as keyof typeof READING_FIXTURES)
      : null
  const view = readingName
    ? READING_FIXTURES[readingName]
    : profileName
      ? PROFILE_STEP_FIXTURES[profileName]
      : questionsName
        ? QUESTIONS_FIXTURES[questionsName]
        : // `?site=register`: the ready review with the address confirmed by the address register (ADR-0172).
          params.site === 'register'
          ? INTAKE_REGISTER
          : INTAKE_FIXTURES[name]
  const [sent, setSent] = useState<string | null>(null)
  const projectState = isProjectStepState(params.project) ? params.project : 'team'
  const participantsClient = useMemo(
    () => createFixtureParticipantsClient(projectState),
    [projectState]
  )
  const proposalsReady = useFakeProposalClient(INTAKE_FILING)
  const filing = useFilingSuggestions({
    query:
      proposalsReady && INTAKE_FILING_STATES.includes(name) ? { projectId: view.projectId } : null,
    watching: false,
  })

  return (
    <div className="bg-background h-dvh" data-testid="project-setup-preview">
      <IntakeSetupView
        key={`${name}-${projectState}-${profileName ?? ''}-${questionsName ?? ''}-${readingName ?? ''}`}
        participantsClient={participantsClient}
        view={view}
        projectId={view.projectId}
        projectName={FIXTURE_PROJECT_NAME}
        busy={busy}
        stale={false}
        canUpload
        uploading={false}
        onFiles={(files) => setSent(`files: ${files.map((file) => file.name).join(', ')}`)}
        onDecide={async (decisions: IntakeDecision[]) => {
          setSent(`decide: ${JSON.stringify(decisions)}`)
          return true
        }}
        onReread={() => setSent('start: {"scope":"new"}')}
        onComplete={async () => {
          setSent('complete')
          return true
        }}
        onRetry={() => setSent('get')}
        filing={{ entries: filing.byFolder, onSettled: filing.reload }}
      />
      {sent && (
        <pre className="bg-card text-muted-foreground fixed bottom-24 left-4 z-50 max-h-40 max-w-md overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 font-mono text-xs shadow">
          {sent}
        </pre>
      )}
    </div>
  )
}
