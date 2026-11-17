/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/base-knowledge/context/service', () => ({ knowledgeContextForTurn: vi.fn(async () => undefined) }))
vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({
  insertDefinition: vi.fn(),
  insertDefinitionWithRun: vi.fn(),
  insertRun: vi.fn(),
  updateRun: vi.fn(),
  closeActiveRun: vi.fn(),
  findRunById: vi.fn(),
}))
vi.mock('./run-moves', () => ({ recordSubmission: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/jobs/service', () => ({
  submitAgentRun: vi.fn(),
  createTaskThread: vi.fn(async () => 's_definition_thread'),
}))
vi.mock('@/lib/skills/service', () => ({ resolveSkillSnapshot: vi.fn() }))
vi.mock('@/lib/conversations/restricted-use', () => ({
  recordedRestrictedFolders: vi.fn(async () => []),
  recordedSourceProjects: vi.fn(async () => []),
}))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn(async () => []) }))
vi.mock('@/lib/documents/repository', () => ({ findProjectDocumentsByFilenames: vi.fn(async () => []) }))

import { ConversationConfinedError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { recordedRestrictedFolders } from '@/lib/conversations/restricted-use'
import type { AccessFolder } from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { findProjectDocumentsByFilenames, type DocumentListRow } from '@/lib/documents/repository'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { TaskDefinition, TaskRun } from '@/lib/db/schema/task-model'
import { JobSubmitError } from '@/lib/jobs/backend-client'
import { AGENT_RUN_INPUT_MAX_CHARS } from '@/lib/jobs/types'
import { createTaskThread, submitAgentRun } from '@/lib/jobs/service'
import { resolveSkillSnapshot } from '@/lib/skills/service'
import * as repository from './repository'
import { recordSubmission } from './run-moves'
import {
  commissionResearchRun,
  delegateTask,
  isDelegatableTaskKind,
  TASK_GOAL_MAX_CHARS,
} from './delegation'
import { PRODUCT_NAME } from '@/lib/brand'

const session = {
  userId: 'user_asker',
  email: 'asker@example.test',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [],
  featureFlags: null,
  accessToken: '',
  name: null,
} as AuthorizedSession

const PROJECT = '3f8b0d2e-0000-4000-8000-000000000001'

let insertedDefinition: TaskDefinition
let insertedRun: TaskRun

function storedRunWrites() {
  vi.mocked(recordSubmission).mockImplementation(async (_id, _org, { status, ...references }) => {
    const starts = status === 'running' && insertedRun.status === 'queued'
    insertedRun = { ...insertedRun, ...references, ...(starts ? { status, startedAt: new Date() } : {}) } as TaskRun
    return insertedRun
  })
  vi.mocked(repository.closeActiveRun).mockImplementation(async (_id, _org, patch) => {
    if (insertedRun.status !== 'queued' && insertedRun.status !== 'running') return null
    insertedRun = { ...insertedRun, ...patch, finishedAt: new Date() } as TaskRun
    return insertedRun
  })
  vi.mocked(repository.findRunById).mockImplementation(async () => insertedRun)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(repository.insertDefinition).mockImplementation(async (values) => {
    insertedDefinition = { ...values, id: 'definition-1', dueAt: values.dueAt ?? null } as TaskDefinition
    return insertedDefinition
  })
  vi.mocked(repository.insertDefinitionWithRun).mockImplementation(async (values, runValues) => {
    insertedDefinition = { ...values, id: 'definition-1', dueAt: values.dueAt ?? null } as TaskDefinition
    insertedRun = {
      ...runValues,
      definitionId: insertedDefinition.id,
      id: 'run-1',
      status: 'queued',
      conversationId: null,
    } as TaskRun
    return { definition: insertedDefinition, run: insertedRun }
  })
  vi.mocked(repository.insertRun).mockImplementation(async (values) => {
    insertedRun = { ...values, id: 'run-1', conversationId: null } as TaskRun
    return insertedRun
  })
  vi.mocked(repository.updateRun).mockImplementation(async (_id, _org, patch) => ({ ...insertedRun, ...patch }) as TaskRun)
  storedRunWrites()
  vi.mocked(createTaskThread).mockResolvedValue('s_definition_thread')
  vi.mocked(submitAgentRun).mockImplementation(async (spec) => ({
    backendJobId: 'backend-1',
    conversationId: spec.conversationId,
    runMessageId: spec.conversationId ? `msg-${spec.runId}` : null,
    queued: false,
  }))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(recordedRestrictedFolders).mockResolvedValue([])
  vi.mocked(listProjectFolderTree).mockResolvedValue([])
  vi.mocked(findProjectDocumentsByFilenames).mockResolvedValue([])
})

describe('delegateTask', () => {
  it('pins the caller as the requester and freezes the goal on the plan', async () => {
    const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'compliance_check', goal: 'Prüf das Haus A' })

    expect(requireProjectAccess).toHaveBeenCalledWith(session, PROJECT, [
      'project:edit',
      'project:documents:write',
    ])
    expect(insertedDefinition.requesterUserId).toBe('user_asker')
    expect(insertedDefinition.requesterEmail).toBe('asker@example.test')
    expect(insertedDefinition.trigger).toBe('once')
    expect(insertedDefinition.plan.goal).toBe('Prüf das Haus A')
    expect(insertedDefinition.plan.prompt).toContain('Prüf das Haus A')
    expect(insertedRun).toMatchObject({
      definitionId: 'definition-1',
      trigger: 'delegated',
      triggeredBy: 'user_asker',
      kind: 'compliance_check',
    })
    expect(run?.status).toBe('running')
  })

  it('records a delegated run the backend queued as queued, not running, and unstarted', async () => {
    vi.mocked(submitAgentRun).mockImplementation(async (spec) => ({
      backendJobId: 'backend-1',
      conversationId: spec.conversationId,
      runMessageId: `msg-${spec.runId}`,
      queued: true,
    }))

    const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'compliance_check', goal: 'Prüf das Haus A' })

    expect(run?.status).toBe('queued')
    expect(run?.startedAt ?? null).toBeNull()
    expect(vi.mocked(recordSubmission).mock.calls[0][2]).toMatchObject({ status: 'queued' })
  })

  it('runs every kind as a chat output, so the work lands in a real thread', async () => {
    await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib den Aktenvermerk' })

    expect(vi.mocked(submitAgentRun).mock.calls[0][0]).toMatchObject({
      organizationId: 'org_1',
      projectId: PROJECT,
      userId: 'user_asker',
      output: 'chat',
      title: 'Dokument: Schreib den Aktenvermerk',
    })
    expect(vi.mocked(repository.insertDefinitionWithRun).mock.calls[0][1]).not.toHaveProperty('conversationId')
    const updated = vi.mocked(recordSubmission).mock.calls[0][2]
    expect(updated).toMatchObject({
      status: 'running',
      backendJobId: 'backend-1',
      conversationId: 's_definition_thread',
    })
  })

  it('lands the run in the thread the person was typing in, and records its message', async () => {
    await delegateTask(session, {
      projectId: PROJECT,
      kind: 'document',
      goal: 'Schreib den Aktenvermerk',
      conversationId: 's_live_chat',
    })

    expect(createTaskThread).not.toHaveBeenCalled()
    expect(vi.mocked(submitAgentRun).mock.calls[0][0]).toMatchObject({
      conversationId: 's_live_chat',
      runId: 'run-1',
    })
    expect(vi.mocked(recordSubmission).mock.calls[0][2]).toMatchObject({
      conversationId: 's_live_chat',
      runMessageId: 'msg-run-1',
    })
  })

  it('gives a delegation nobody typed the definition’s own thread', async () => {
    await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

    expect(createTaskThread).toHaveBeenCalledWith(insertedDefinition)
    expect(vi.mocked(submitAgentRun).mock.calls[0][0]).toMatchObject({
      conversationId: 's_definition_thread',
    })
  })

  it('names the submission-check skill in the prompt and pastes no body', async () => {
    await delegateTask(session, { projectId: PROJECT, kind: 'submission_check', goal: 'Prüf die Einreichung' })

    expect(insertedDefinition.plan.prompt).toContain('/submission-check')
    expect(insertedDefinition.plan.prompt).not.toContain('verbindlich')
    expect(resolveSkillSnapshot).not.toHaveBeenCalled()
  })

  it('freezes no snapshot, so nothing can be delivered without the model asking', async () => {
    await delegateTask(session, { projectId: PROJECT, kind: 'submission_check', goal: 'Prüf die Einreichung' })

    expect(insertedDefinition.plan.skill).toEqual({})
    expect(insertedRun.skillSnapshot).toEqual({})
  })

  it('quotes the version being revised into the prompt, fenced and bounded', async () => {
    await delegateTask(session, {
      projectId: PROJECT,
      kind: 'revision',
      goal: 'Die Fluchtweglänge stimmt nicht',
      subject: { documentId: 'doc-3', versionId: 'ver-1', comment: 'Die Fluchtweglänge stimmt nicht' },
      sourceText: '# Befund\n\nDie Länge beträgt 42 m.',
      requester: { userId: 'user_author', email: null },
    })

    expect(insertedDefinition.plan.prompt).toContain('```markdown')
    expect(insertedDefinition.plan.prompt).toContain('Die Länge beträgt 42 m.')
    expect(insertedDefinition.plan.subject).toEqual({
      documentId: 'doc-3',
      versionId: 'ver-1',
      comment: 'Die Fluchtweglänge stimmt nicht',
    })
    expect(insertedDefinition.requesterUserId).toBe('user_author')
  })

  describe('a document longer than one run can carry', () => {
    const revise = (sourceText: string) =>
      delegateTask(session, {
        projectId: PROJECT,
        kind: 'revision',
        goal: 'Abschnitt 3 präzisieren',
        subject: { documentId: 'doc-3', versionId: 'ver-1', comment: 'Abschnitt 3 präzisieren' },
        sourceText,
      })

    it('never hands the submit route a prompt over its input ceiling', async () => {
      await revise('# Langer Bericht\n\n' + 'Absatz. '.repeat(6_500))

      for (const [spec] of vi.mocked(submitAgentRun).mock.calls) {
        expect(spec.prompt.length).toBeLessThanOrEqual(AGENT_RUN_INPUT_MAX_CHARS)
      }
      expect(insertedDefinition.plan.prompt.length).toBeLessThanOrEqual(AGENT_RUN_INPUT_MAX_CHARS)
    })

    it('is refused on the run in words, not cut: the answer replaces the whole version', async () => {
      const { run } = await revise('# Langer Bericht\n\n' + 'Absatz. '.repeat(6_500) + '\n\n## Anhang')

      expect(submitAgentRun).not.toHaveBeenCalled()
      expect(run?.status).toBe('failed')
      expect(run?.error).toContain('zu lang')
      expect(run?.error).toContain(`Mit ${PRODUCT_NAME} besprechen`)
      expect(insertedDefinition.plan.prompt).not.toContain('Absatz.')
    })

    it('quotes a document that fills the budget exactly, whole', async () => {
      await revise('x')
      const budget = AGENT_RUN_INPUT_MAX_CHARS - (insertedDefinition.plan.prompt.length - 1)
      vi.mocked(submitAgentRun).mockClear()

      const document = '# Bericht\n\n' + 'y'.repeat(budget - '# Bericht\n\n'.length - 1) + 'Z'
      const { run } = await revise(document)

      const submitted = vi.mocked(submitAgentRun).mock.calls[0][0].prompt
      expect(submitted.length).toBe(AGENT_RUN_INPUT_MAX_CHARS)
      expect(submitted).toContain(document)
      expect(run?.status).toBe('running')

      const { run: over } = await revise(`${document}!`)
      expect(over?.status).toBe('failed')
    })
  })

  it('refuses a revision with no version to revise', async () => {
    await expect(
      delegateTask(session, { projectId: PROJECT, kind: 'revision', goal: 'Überarbeite' }),
    ).rejects.toBeInstanceOf(UnprocessableError)
  })

  it('refuses an empty or over-long goal before anything is written', async () => {
    await expect(
      delegateTask(session, { projectId: PROJECT, kind: 'document', goal: '   ' }),
    ).rejects.toBeInstanceOf(UnprocessableError)
    await expect(
      delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'x'.repeat(TASK_GOAL_MAX_CHARS + 1) }),
    ).rejects.toBeInstanceOf(UnprocessableError)
    expect(repository.insertDefinition).not.toHaveBeenCalled()
  })

  it('records a submission failure ON the run rather than throwing it at the caller', async () => {
    vi.mocked(submitAgentRun).mockRejectedValue(new JobSubmitError('backend unreachable', 502))

    const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('backend unreachable')
  })

  it('does not call a submitted run failed when recording it fails (#723)', async () => {
    vi.mocked(recordSubmission).mockRejectedValue(new Error('connect EHOSTUNREACH 10.0.0.1:5432'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

    expect(run?.status).toBe('running')
    expect(run?.backendJobId).toBeTruthy()
    expect(vi.mocked(recordSubmission).mock.calls.map(([, , submission]) => submission.status)).toEqual(['running'])
    expect(repository.closeActiveRun).not.toHaveBeenCalled()
  })

  it('still returns the failed run when recording the failure fails too', async () => {
    vi.mocked(submitAgentRun).mockRejectedValue(new JobSubmitError('backend unreachable', 502))
    vi.mocked(repository.closeActiveRun).mockRejectedValue(new Error('the database system is shutting down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

    expect(run?.status).toBe('failed')
  })

  describe('what the submit records follows the run lifecycle', () => {
    function duringTheSubmit(change: Partial<TaskRun>) {
      vi.mocked(submitAgentRun).mockImplementation(async (spec) => {
        insertedRun = { ...insertedRun, ...change } as TaskRun
        return { backendJobId: 'backend-1', conversationId: spec.conversationId, runMessageId: `msg-${spec.runId}`, queued: change.status === 'running' }
      })
    }

    it('never writes a status past the lifecycle: no unconditional update carries one', async () => {
      await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

      const statusWrites = vi.mocked(repository.updateRun).mock.calls.filter(([, , patch]) => 'status' in patch)
      expect(statusWrites).toEqual([])
      expect(recordSubmission).toHaveBeenCalledTimes(1)
    })

    it('keeps the ending of a row the kill switch closed during the submit, and still records the job', async () => {
      duringTheSubmit({ status: 'interrupted', error: 'Abgebrochen.' })

      const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

      expect(run).toMatchObject({ status: 'interrupted', error: 'Abgebrochen.', backendJobId: 'backend-1' })
    })

    it('does not put a run the worker already started back to queued', async () => {
      const startedAt = new Date('2026-11-11T10:00:00.000Z')
      duringTheSubmit({ status: 'running', startedAt })

      const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

      expect(run).toMatchObject({ status: 'running', startedAt, backendJobId: 'backend-1' })
    })

    it('keeps the ending that stands when the submit fails on a row already ended', async () => {
      vi.mocked(submitAgentRun).mockImplementation(async () => {
        insertedRun = { ...insertedRun, status: 'interrupted', error: 'Abgebrochen.' } as TaskRun
        throw new JobSubmitError('backend unreachable', 502)
      })

      const { run } = await delegateTask(session, { projectId: PROJECT, kind: 'document', goal: 'Schreib das' })

      expect(run).toMatchObject({ status: 'interrupted', error: 'Abgebrochen.' })
    })
  })

  it('audits the creation as `task.created`, with the trigger named', async () => {
    await delegateTask(session, { projectId: PROJECT, kind: 'compliance_check', goal: 'Prüf das' })
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'task.created',
        targetType: 'task',
        targetId: 'run-1',
        metadata: expect.objectContaining({ kind: 'compliance_check', trigger: 'delegated' }),
      }),
    )
  })
})

describe('isDelegatableTaskKind', () => {
  it('accepts the four engines and refuses the two job outputs', () => {
    for (const kind of ['compliance_check', 'submission_check', 'document', 'revision']) {
      expect(isDelegatableTaskKind(kind)).toBe(true)
    }
    expect(isDelegatableTaskKind('chat')).toBe(false)
    expect(isDelegatableTaskKind('deep-research')).toBe(false)
  })
})

describe('a cadence turns the delegation into a schedule', () => {
  it('creates a recurring definition and dispatches nothing', async () => {
    const result = await delegateTask(session, {
      projectId: PROJECT,
      kind: 'document',
      goal: 'Prüf das jeden Montag',
      cadence: { cron: '0 8 * * 1' },
    })

    expect(insertedDefinition).toMatchObject({
      trigger: 'schedule',
      scheduleCron: '0 8 * * 1',
      scheduleTimezone: 'UTC',
      dueAt: null,
    })
    expect(insertedDefinition.nextRunAt).toBeInstanceOf(Date)
    expect(result.run).toBeNull()
    expect(repository.insertDefinitionWithRun).not.toHaveBeenCalled()
    expect(submitAgentRun).not.toHaveBeenCalled()
  })

  it('refuses a cadence from a requester without project:skills:manage, creating nothing', async () => {
    vi.mocked(requireProjectAccess)
      .mockResolvedValueOnce({ role: 'project-admin' } as never)
      .mockRejectedValueOnce(new NotFoundError('Project not found'))

    await expect(
      delegateTask(session, {
        projectId: PROJECT,
        kind: 'document',
        goal: 'Prüf das jeden Montag',
        cadence: { cron: '0 8 * * 1' },
      }),
    ).rejects.toThrow('project:skills:manage')

    expect(repository.insertDefinition).not.toHaveBeenCalled()
    expect(submitAgentRun).not.toHaveBeenCalled()
  })

  it('refuses a delegation that is both one-off and recurring', async () => {
    await expect(
      delegateTask(session, {
        projectId: PROJECT,
        kind: 'document',
        goal: 'Prüf das',
        dueAt: new Date('2026-09-18T23:59:59Z'),
        cadence: { cron: '0 8 * * 1' },
      }),
    ).rejects.toBeInstanceOf(UnprocessableError)
    expect(repository.insertDefinition).not.toHaveBeenCalled()
  })
})

describe('what a delegated run is told to produce', () => {
  it('never tells a `document` or `revision` run to call the filing tools', async () => {
    for (const kind of ['document', 'revision'] as const) {
      vi.clearAllMocks()
      vi.mocked(repository.insertDefinition).mockImplementation(async (values) => {
        insertedDefinition = { ...values, id: 'definition-1' } as TaskDefinition
        return insertedDefinition
      })
      vi.mocked(repository.insertDefinitionWithRun).mockImplementation(async (values, runValues) => {
        insertedDefinition = { ...values, id: 'definition-1' } as TaskDefinition
        insertedRun = { ...runValues, definitionId: insertedDefinition.id, id: 'run-1' } as TaskRun
        return { definition: insertedDefinition, run: insertedRun }
      })
      vi.mocked(repository.insertRun).mockImplementation(async (values) => {
    insertedRun = { ...values, id: 'run-1', conversationId: null } as TaskRun
    return insertedRun
  })
  vi.mocked(repository.updateRun).mockImplementation(async (_id, _org, patch) => ({ ...insertedRun, ...patch }) as TaskRun)
  storedRunWrites()
      vi.mocked(submitAgentRun).mockResolvedValue({
        backendJobId: 'b',
        conversationId: null,
        runMessageId: null,
        queued: false,
      })
      await delegateTask(session, {
        projectId: PROJECT,
        kind,
        goal: 'Schreib das',
        subject: kind === 'revision' ? { documentId: 'd', versionId: 'v', comment: 'c' } : undefined,
      })
      expect(insertedDefinition.plan.prompt).not.toContain('file_draft')
      expect(insertedDefinition.plan.prompt).not.toContain('submit_draft')
      expect(insertedDefinition.plan.prompt).toContain('Markdown')
    }
  })
})


describe('commissionResearchRun — an escalated question becomes a run', () => {
  const THREAD = 's_where_it_was_asked'
  const QUESTION = 'Gilt für das Atrium in Haus A OIB 2 oder OIB 2.3? Bitte mit den Wiener Abweichungen.'

  it('writes one run with no definition behind it, in the thread it was asked in', async () => {
    const result = await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
    })

    const inserted = vi.mocked(repository.insertRun).mock.calls[0][0]
    expect(inserted).toMatchObject({
      definitionId: null,
      kind: 'deep-research',
      trigger: 'delegated',
      triggeredBy: 'user_asker',
      status: 'queued',
      requesterUserId: 'user_asker',
      projectId: PROJECT,
    })
    expect(inserted.plan?.prompt).toBe(QUESTION)
    expect(inserted.title).toBe('Gilt für das Atrium in Haus A OIB 2 oder OIB 2.3?')

    expect(vi.mocked(submitAgentRun).mock.calls[0][0]).toMatchObject({
      output: 'deep-research',
      conversationId: THREAD,
      runId: 'run-1',
    })
    expect(createTaskThread).not.toHaveBeenCalled()

    expect(result).toEqual({
      runId: 'run-1',
      runMessageId: 'msg-run-1',
      conversationId: THREAD,
      status: 'running',
    })
  })

  it('composes what the turn already settled below the question, and keeps it out of the title', async () => {
    await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
      context: 'Frage: Welches Geschoss? Antwort: Das Erdgeschoss.',
    })

    const inserted = vi.mocked(repository.insertRun).mock.calls[0][0]
    expect(inserted.plan?.prompt).toBe(
      `${QUESTION}\n\nWas in der Unterhaltung bereits geklärt wurde:\nFrage: Welches Geschoss? Antwort: Das Erdgeschoss.`,
    )
    expect(inserted.title).toBe('Gilt für das Atrium in Haus A OIB 2 oder OIB 2.3?')
  })

  it('carries the Rahmen and the Unterlagen onto the run and to the worker, and the context as the clarifier result', async () => {
    const documents = {
      basis: [{ name: 'Einreichplan.pdf', title: 'Einreichplan EG', shelf: 'project' }],
      excluded: [{ name: 'alt.pdf' }],
    }
    await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
      context: 'Frage: Welches Geschoss? Antwort: Das Erdgeschoss.',
      dataSources: ['knowledge_base'],
      documents,
    })

    const inserted = vi.mocked(repository.insertRun).mock.calls[0][0]
    expect(inserted.plan).toMatchObject({
      dataSources: ['knowledge_base'],
      context: 'Frage: Welches Geschoss? Antwort: Das Erdgeschoss.',
      documents,
    })
    expect(vi.mocked(submitAgentRun).mock.calls[0][0]).toMatchObject({
      dataSources: ['knowledge_base'],
      clarifierResult: 'Frage: Welches Geschoss? Antwort: Das Erdgeschoss.',
      documents,
    })
  })

  it('records no Unterlagen when the lists are empty', async () => {
    await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
      documents: { basis: [], excluded: [] },
    })
    const inserted = vi.mocked(repository.insertRun).mock.calls[0][0]
    expect(inserted.plan).not.toHaveProperty('documents')
  })

  it('asks for the same permissions handing over a task asks for', async () => {
    await commissionResearchRun(session, { projectId: PROJECT, conversationId: THREAD, question: QUESTION })
    expect(requireProjectAccess).toHaveBeenCalledWith(session, PROJECT, [
      'project:edit',
      'project:documents:write',
    ])
  })

  it('refuses a question that says nothing, and one past the bound', async () => {
    await expect(
      commissionResearchRun(session, { projectId: PROJECT, conversationId: THREAD, question: '   ' }),
    ).rejects.toBeInstanceOf(UnprocessableError)
    await expect(
      commissionResearchRun(session, {
        projectId: PROJECT,
        conversationId: THREAD,
        question: 'x'.repeat(TASK_GOAL_MAX_CHARS + 1),
      }),
    ).rejects.toBeInstanceOf(UnprocessableError)
    expect(repository.insertRun).not.toHaveBeenCalled()
  })

  it('records a refused submission as a failed run instead of throwing', async () => {
    vi.mocked(submitAgentRun).mockRejectedValue(new JobSubmitError('backend unreachable', 502))

    const result = await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
    })

    expect(result.status).toBe('failed')
    expect(vi.mocked(repository.closeActiveRun).mock.calls[0][2]).toEqual({
      status: 'failed',
      error: 'backend unreachable',
    })
  })

  it('lets a refused gate through: there is no run to record yet', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new NotFoundError('Unknown project'))
    await expect(
      commissionResearchRun(session, { projectId: PROJECT, conversationId: THREAD, question: QUESTION }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(repository.insertRun).not.toHaveBeenCalled()
  })
})

describe('nothing is handed over from a conversation that drew on a restricted folder (ADR-0087)', () => {
  const THREAD = 's_confined'
  const RESTRICTED = '01234567-89ab-4cde-8f01-23456789abcd'
  const QUESTION = 'Welches Honorar ist für LP 5 vereinbart?'

  it('refuses a research run from a thread that recorded a restricted folder, in German, before any row exists', async () => {
    vi.mocked(recordedRestrictedFolders).mockResolvedValue([RESTRICTED])
    const error = await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConversationConfinedError)
    expect((error as ConversationConfinedError).action).toBe('deepResearch')
    expect((error as ConversationConfinedError).message).toContain('keine Tiefenrecherche')
    expect(recordedRestrictedFolders).toHaveBeenCalledWith(THREAD, 'org_1')
    expect(repository.insertRun).not.toHaveBeenCalled()
    expect(submitAgentRun).not.toHaveBeenCalled()
  })

  it('commissions a research run from a thread that recorded nothing, whatever its socket could search', async () => {
    await commissionResearchRun(session, { projectId: PROJECT, conversationId: THREAD, question: QUESTION })
    expect(repository.insertRun).toHaveBeenCalled()
  })

  it('refuses a task from a thread that recorded a restricted folder, in the reader’s language when one is given', async () => {
    vi.mocked(recordedRestrictedFolders).mockResolvedValue([RESTRICTED])
    const error = await delegateTask(session, {
      projectId: PROJECT,
      kind: 'compliance_check',
      goal: 'Prüf das Haus A',
      conversationId: THREAD,
      locale: 'en',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConversationConfinedError)
    expect((error as ConversationConfinedError).action).toBe('task')
    expect((error as ConversationConfinedError).message).toContain('cannot create a task')
    expect(repository.insertDefinition).not.toHaveBeenCalled()
    expect(repository.insertDefinitionWithRun).not.toHaveBeenCalled()
  })

  it('still delegates a task nobody typed (a reviewer’s send-back) without asking about a thread', async () => {
    await delegateTask(session, { projectId: PROJECT, kind: 'compliance_check', goal: 'Prüf das Haus A' })
    expect(recordedRestrictedFolders).not.toHaveBeenCalled()
    expect(repository.insertDefinitionWithRun).toHaveBeenCalled()
  })
})

describe('a run’s Unterlagen never name a document from a restricted folder (ADR-0087)', () => {
  const THREAD = 's_open_thread'
  const QUESTION = 'Was steht in der Abmahnung?'
  const PERSONAL = 'folder-personal'
  const OPEN = 'folder-plaene'
  const TREE: AccessFolder[] = [
    { id: PERSONAL, parentId: null, accessMode: 'custom', everyoneReads: false },
    { id: OPEN, parentId: null, accessMode: 'inherit', everyoneReads: false },
  ]
  const row = (filename: string, folderId: string | null) =>
    ({ id: `doc-${filename}`, filename, folderId }) as DocumentListRow

  beforeEach(() => {
    vi.mocked(listProjectFolderTree).mockResolvedValue(TREE)
    vi.mocked(findProjectDocumentsByFilenames).mockImplementation(async (_project, _org, names) =>
      [row('Abmahnung_Meier_2026.pdf', PERSONAL), row('Einreichplan.pdf', OPEN)].filter((r) =>
        names.includes(r.filename),
      ),
    )
  })

  it('refuses a restricted-folder document on the Grundlage before any row exists, whoever names it', async () => {
    const error = await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
      documents: {
        basis: [{ name: 'Abmahnung_Meier_2026.pdf', title: 'Abmahnung Meier', shelf: 'project' }],
        excluded: [],
      },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConversationConfinedError)
    expect((error as ConversationConfinedError).action).toBe('planDocument')
    expect((error as ConversationConfinedError).message).toContain('Ordner mit eingeschränktem Zugriff')
    expect(findProjectDocumentsByFilenames).toHaveBeenCalledWith(PROJECT, 'org_1', ['Abmahnung_Meier_2026.pdf'], {
      includeArchived: true,
      reader: { kind: 'internal', why: 'identity' },
    })
    expect(repository.insertRun).not.toHaveBeenCalled()
    expect(submitAgentRun).not.toHaveBeenCalled()
  })

  it('refuses one on the excluded list too: the plan names it to everyone either way', async () => {
    const error = await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
      documents: { basis: [], excluded: [{ name: 'Abmahnung_Meier_2026.pdf' }] },
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConversationConfinedError)
    expect(submitAgentRun).not.toHaveBeenCalled()
  })

  it('commissions a run whose Unterlagen sit in open folders, and never looks up an Archiv entry', async () => {
    await commissionResearchRun(session, {
      projectId: PROJECT,
      conversationId: THREAD,
      question: QUESTION,
      documents: {
        basis: [
          { name: 'Einreichplan.pdf', shelf: 'project' },
          { name: 'Abmahnung_Meier_2026.pdf', shelf: 'office_shelf' },
        ],
        excluded: [],
      },
    })
    expect(findProjectDocumentsByFilenames).toHaveBeenCalledWith(PROJECT, 'org_1', ['Einreichplan.pdf'], {
      includeArchived: true,
      reader: { kind: 'internal', why: 'identity' },
    })
    expect(submitAgentRun).toHaveBeenCalled()
  })
})
