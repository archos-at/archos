import 'server-only'
import { z } from 'zod'
import { recordAuditEvent, SYSTEM_ACTORS } from '@/lib/audit/service'
import { sourceFoldersOfCollections } from '@/lib/authz/folder-access'
import { PROJECT_MEMORY_JUDGE_VERDICTS, type ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { findProjectInOrg } from './repository'

export const memoryJudgeVerdictSchema = z.object({
  verdict: z.enum(PROJECT_MEMORY_JUDGE_VERDICTS),
  judgedCollections: z.array(z.string().max(255)).max(1000),
  drawnCollections: z.array(z.string().max(255)).max(1000).default([]),
})

export type MemoryJudgeVerdict = z.infer<typeof memoryJudgeVerdictSchema>

type JudgedItem = Pick<
  ProjectMemoryItem,
  'id' | 'organizationId' | 'projectId' | 'restrictedFolderIds' | 'provenanceType' | 'sourceConversationId'
>

type RefusedWrite = Pick<ProjectMemoryItem, 'organizationId' | 'provenanceType' | 'sourceConversationId'>

interface JudgedSubject {
  organizationId: string
  projectId: string | null
  targetType: 'project_memory_item' | 'organization'
  targetId: string
  outcome: 'stored' | 'refused'
  restrictedFolderIds: readonly string[]
  provenance: string
  conversationId: string | null
}

const joined = (values: readonly string[]): string => values.join(',').slice(0, 500)

async function folderOfCollection(subject: JudgedSubject, collections: readonly string[]): Promise<Map<string, string>> {
  if (!subject.projectId || collections.length === 0) return new Map()
  const project = await findProjectInOrg(subject.projectId, subject.organizationId)
  if (!project) return new Map()
  return sourceFoldersOfCollections(subject.organizationId, subject.projectId, project.collectionName, collections)
}

async function recordVerdict(subject: JudgedSubject, judge: MemoryJudgeVerdict): Promise<void> {
  try {
    const named = [...new Set([...judge.judgedCollections, ...judge.drawnCollections])]
    const folders = await folderOfCollection(subject, named)
    const asFolders = (collections: readonly string[]) =>
      [...new Set(collections.map((name) => folders.get(name) ?? name))].sort()
    const judged = asFolders(judge.judgedCollections)
    const drawn = asFolders(judge.drawnCollections)
    await recordAuditEvent({
      organizationId: subject.organizationId,
      actor: { userId: SYSTEM_ACTORS.memoryJudge, email: null },
      action: 'project.memory.restriction_judged',
      targetType: subject.targetType,
      targetId: subject.targetId,
      metadata: {
        projectId: subject.projectId ?? '',
        verdict: judge.verdict,
        outcome: subject.outcome,
        judgedFolders: joined(judged),
        judgedCount: judged.length,
        drawnFolders: joined(drawn),
        drawnCount: drawn.length,
        restrictedFolders: joined(subject.restrictedFolderIds),
        provenance: subject.provenance,
        conversationId: subject.conversationId ?? '',
      },
    })
  } catch (error) {
    console.error('[memory-judge-audit] could not record the judge verdict:', error)
  }
}

export async function recordMemoryJudgeVerdict(item: JudgedItem, judge: MemoryJudgeVerdict): Promise<void> {
  await recordVerdict(
    {
      organizationId: item.organizationId,
      projectId: item.projectId,
      targetType: 'project_memory_item',
      targetId: item.id,
      outcome: 'stored',
      restrictedFolderIds: item.restrictedFolderIds ?? [],
      provenance: item.provenanceType,
      conversationId: item.sourceConversationId,
    },
    judge
  )
}

export async function recordRefusedMemoryJudgeVerdict(refused: RefusedWrite, judge: MemoryJudgeVerdict): Promise<void> {
  await recordVerdict(
    {
      organizationId: refused.organizationId,
      projectId: null,
      targetType: 'organization',
      targetId: refused.organizationId,
      outcome: 'refused',
      restrictedFolderIds: [],
      provenance: refused.provenanceType,
      conversationId: refused.sourceConversationId,
    },
    judge
  )
}
