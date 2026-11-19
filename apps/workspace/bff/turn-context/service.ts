import 'server-only'
import { drewOnOtherProjects } from '@/lib/conversations/cross-project-use'
import { loadReferenceBrief } from '@/lib/cross-project/reference-brief'
import type { AuthorizedSession } from '@/lib/auth/types'
import { NotFoundError } from '@/lib/api/errors'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadProjectPromptView } from '@/lib/project-profile/prompt-view'
import { resolveOrgInstructions } from '@/lib/org-instructions/service'
import { buildProjectMemoryDigest } from '@/lib/projects/memory-service'
import { buildPersonalMemoryDigest } from '@/lib/personal-memory/service'
import { isTemporaryConversation } from '@/lib/conversations/temporary'
import type { DigestTiming } from '@/lib/projects/memory-recall'
import { buildProposalDecisionsBlock, composeMemoryContext } from '@/lib/projects/proposal-decisions'
import { buildReviewDecisionsBlock } from '@/lib/documents/review-decisions'
import { buildFolderDescriptionsBlock } from '@/lib/filing/folder-descriptions-block'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { getDb } from '@/lib/db'
import { isSoloAudience } from '@/lib/conversations/cross-project-use'
import { readConversationAudience } from '@/lib/conversations/restricted-use-repository'
import { countPendingInboxItems, EVERY_INBOX_TYPE } from '@/lib/inbox/repository'
import { listConversationProposals } from '@/lib/proposals/repository'
import { findProjectInOrg } from '@/lib/projects/repository'
import { countActiveRunsInProject } from '@/lib/tasks/repository'
import { officeConventionsForTurn } from '@/lib/office-conventions/service'
import { baseKnowledgeForTurn, type TurnKnowledge } from '@/lib/base-knowledge/office/service'
import { officeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { knowledgeContextForTurn } from '@/lib/base-knowledge/context/service'
import { goldenTurnFor } from '@/lib/base-knowledge/golden/turn'
import { projectModelKinds } from '@/lib/bim/model-kinds-repository'
import type { ProjectAccess } from '@/lib/authz/projects'
import { TurnContextTiming } from './timing'
import type { TurnContextRequest, TurnContextResponse } from './wire'
import {
  MAX_WORKSPACE_PROPOSALS,
  type WorkspaceFacts,
  proposalOutcomeOf,
  proposalSummaryOf,
  renderWorkspaceBlock,
} from './workspace-block'

async function advisory<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    console.warn(`[Turn Context API] Failed to ${what}:`, error)
    return null
  }
}

async function loadWorkspaceBlock(
  session: AuthorizedSession,
  context: VerifiedRequestContext,
  projectAccess: ProjectAccess | null,
  query: string | undefined,
  solo: Promise<boolean | null>,
): Promise<string> {
  const { organizationId, projectId, conversationId, userId } = context
  const [project, audience, inboxWaiting, activeRuns, proposals, officeConventions] = await Promise.all([
    projectId ? advisory('load the project', () => findProjectInOrg(projectId, organizationId)) : Promise.resolve(null),
    solo.then((alone) => (alone === null ? null : alone ? ('solo' as const) : ('shared' as const))),
    advisory('count the inbox', () => countPendingInboxItems(organizationId, userId, EVERY_INBOX_TYPE)),
    projectId
      ? advisory('count the project runs', () => countActiveRunsInProject(projectId, organizationId))
      : Promise.resolve(null),
    conversationId
      ? advisory('list the conversation proposals', () =>
          listConversationProposals(organizationId, conversationId, MAX_WORKSPACE_PROPOSALS + 1),
        )
      : Promise.resolve(null),
    advisory('load the office conventions', () => officeConventionsForTurn(organizationId, query)),
  ])
  const facts: WorkspaceFacts = {
    organizationRole: session.role || null,
    projectRole: projectAccess?.role ?? null,
    project: projectId && project ? { id: projectId, name: project.name, status: project.status } : null,
    conversation: conversationId ? { id: conversationId, audience: audience ?? 'unknown' } : null,
    inboxWaiting,
    activeRuns,
    proposals: (proposals ?? []).slice(0, MAX_WORKSPACE_PROPOSALS).map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      summary: proposalSummaryOf(row.kind, row.payload),
      outcome: proposalOutcomeOf(row.results),
    })),
    proposalsTruncated: (proposals?.length ?? 0) > MAX_WORKSPACE_PROPOSALS,
    officeConventions,
  }
  return renderWorkspaceBlock(facts)
}

function readSoloAudience(context: VerifiedRequestContext): Promise<boolean | null> {
  const { organizationId, conversationId, userId } = context
  if (!conversationId) return Promise.resolve(null)
  return advisory('load the conversation audience', async () =>
    isSoloAudience(await readConversationAudience(getDb(), organizationId, conversationId), userId),
  )
}

async function loadPersonalMemory(context: VerifiedRequestContext, solo: Promise<boolean | null>): Promise<string | null> {
  if (context.conversationId && (await solo) !== true) return null
  return advisory('load the personal memory', () =>
    buildPersonalMemoryDigest({ organizationId: context.organizationId, userId: context.userId }),
  )
}

async function loadOfficeStandards(organizationId: string, projectId: string | null, knowledge: Promise<TurnKnowledge>) {
  if (!(await officeStandardsEnabled(organizationId))) return null
  return baseKnowledgeForTurn(organizationId, projectId, knowledge)
}

async function checkAccess(session: AuthorizedSession, context: VerifiedRequestContext): Promise<ProjectAccess | null> {
  const { organizationId, projectId, conversationId } = context
  const projectAccess = projectId ? await requireProjectAccess(session, projectId, CHAT_PERMISSIONS) : null
  if (conversationId) {
    const tenancy = await withPlatformAccess(
      'turn-context conversation existence probe; all access is checked before prompt reads',
      () => findConversationTenancy(conversationId),
    )
    if (tenancy) {
      if (tenancy.organizationId !== organizationId || tenancy.deletedAt) throw new NotFoundError()
      await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
    }
  }
  return projectAccess
}

export async function loadTurnContext(
  session: AuthorizedSession,
  context: VerifiedRequestContext,
  input: TurnContextRequest,
  timing: TurnContextTiming = new TurnContextTiming(),
): Promise<TurnContextResponse> {
  const { organizationId, projectId, conversationId } = context
  const projectAccess = await timing.time('access', () => checkAccess(session, context))
  const query = input.query || undefined
  const digestTiming: DigestTiming = {}
  const timed = <T>(name: string, load: () => Promise<T>) => timing.time(name, load)
  const goldenTurn = goldenTurnFor(organizationId, conversationId)
  const solo = readSoloAudience(context)
  const knowledge = goldenTurn.then(
    (golden) => golden?.knowledgeContext ?? knowledgeContextForTurn(organizationId, projectId ?? null, timed, conversationId ?? null),
  )

  const [projectContext, orgInstructions, digest, personalMemory, temporary, decisions, reviewDecisions, drewOnOthers, referenceProjects, folders, workspace, baseKnowledge, knowledgeContext, projectModels] = await Promise.all([
    projectId ? timed('profile', () => loadProjectPromptView(projectId, organizationId)) : Promise.resolve(null),
    timed('instructions', () => resolveOrgInstructions(organizationId)),
    timed('memory', () => buildProjectMemoryDigest(projectId ?? undefined, organizationId, { query, timing: digestTiming })),
    timed('personal-memory', () => loadPersonalMemory(context, solo)),
    timed('temporary', () => isTemporaryConversation(conversationId, organizationId)),
    projectId
      ? timed('decisions', () => advisory('load proposal decisions', () => buildProposalDecisionsBlock(projectId, organizationId)))
      : Promise.resolve(null),
    conversationId
      ? timed('reviews', () => advisory('load review decisions', () => buildReviewDecisionsBlock(conversationId, organizationId)))
      : Promise.resolve(null),
    conversationId ? timed('cross-project', () => drewOnOtherProjects(conversationId, organizationId)) : Promise.resolve(false),
    timed('references', () => advisory('load reference projects', () => loadReferenceBrief(organizationId, projectId ?? null))),
    timed('folders', () => advisory('load folder descriptions', () => buildFolderDescriptionsBlock(organizationId, projectId ?? null))),
    timed('workspace', () => advisory('load the workspace block', () => loadWorkspaceBlock(session, context, projectAccess, query, solo))),
    timed('base-knowledge', () => advisory('load the base knowledge', () => loadOfficeStandards(organizationId, projectId ?? null, knowledge))),
    knowledge,
    projectId
      ? timed('models', () => advisory('read the project models', () => projectModelKinds(organizationId, projectId, conversationId ?? null)))
      : Promise.resolve(null),
  ])
  if (digestTiming.dense) timing.describe('memory', digestTiming.dense)
  return {
    projectContext: (await goldenTurn)?.projectContext ?? projectContext,
    projectMemory: composeMemoryContext(digest, decisions, reviewDecisions, folders),
    orgInstructions,
    personalMemory,
    temporary,
    drewOnOtherProjects: drewOnOthers,
    referenceProjects,
    workspace,
    baseKnowledge: baseKnowledge?.block ?? null,
    baseKnowledgeLabels: (baseKnowledge?.labels ?? []).map((label) => ({ ...label })),
    knowledgeContext,
    projectModels,
  }
}
