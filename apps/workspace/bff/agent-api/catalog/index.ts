import { AGENT_DOMAINS, type AgentOperation, type OperationExample } from '../operation'
import { baseKnowledgeOperations } from './base-knowledge'
import { baseKnowledgeTimeOperations } from './base-knowledge-time'
import { knowledgeContextOperations } from './knowledge-context'
import { bimOperations } from './bim'
import { collaborationOperations } from './collaboration'
import { consultOperations } from './consult'
import { conversationsOperations } from './conversations'
import { documentsOperations } from './documents'
import { foldersOperations } from './folders'
import { knowledgeOperations } from './knowledge'
import { mailOperations } from './mail'
import { organizationOperations } from './organization'
import { platformOperations } from './platform'
import { platformKnowledgeOperations } from './platform-knowledge'
import { platformSkillOperations } from './platform-skills'
import { platformSourceOperations } from './platform-sources'
import { projectsOperations } from './projects'
import { releaseNotesOperations } from './release-notes'
import { reviewOperations } from './review'
import { savedSearchOperations } from './saved-searches'
import { skillsOperations } from './skills'
import { tasksOperations } from './tasks'

export type OperationName = (
  | typeof projectsOperations
  | typeof documentsOperations
  | typeof savedSearchOperations
  | typeof foldersOperations
  | typeof mailOperations
  | typeof reviewOperations
  | typeof conversationsOperations
  | typeof consultOperations
  | typeof collaborationOperations
  | typeof tasksOperations
  | typeof skillsOperations
  | typeof knowledgeOperations
  | typeof baseKnowledgeOperations
  | typeof baseKnowledgeTimeOperations
  | typeof knowledgeContextOperations
  | typeof bimOperations
  | typeof organizationOperations
  | typeof releaseNotesOperations
  | typeof platformOperations
  | typeof platformKnowledgeOperations
  | typeof platformSkillOperations
  | typeof platformSourceOperations
)[number]['name']

const unordered: readonly AgentOperation[] = [
  ...projectsOperations,
  ...documentsOperations,
  ...savedSearchOperations,
  ...foldersOperations,
  ...mailOperations,
  ...reviewOperations,
  ...conversationsOperations,
  ...consultOperations,
  ...collaborationOperations,
  ...tasksOperations,
  ...skillsOperations,
  ...knowledgeOperations,
  ...baseKnowledgeOperations,
  ...baseKnowledgeTimeOperations,
  ...knowledgeContextOperations,
  ...bimOperations,
  ...organizationOperations,
  ...releaseNotesOperations,
  ...platformOperations,
  ...platformKnowledgeOperations,
  ...platformSkillOperations,
  ...platformSourceOperations,
]

export const AGENT_OPERATIONS: readonly AgentOperation[] = [...unordered].sort(
  (a, b) =>
    AGENT_DOMAINS.indexOf(a.domain) - AGENT_DOMAINS.indexOf(b.domain) || a.name.localeCompare(b.name),
)

const byName = new Map(AGENT_OPERATIONS.map((op) => [op.name, op]))

export interface RenamedWithInput {
  readonly to: string
  readonly input: OperationExample
  readonly rewrite?: (given: OperationExample) => OperationExample
}

const OFFICE_QUERY = { query: { scope: 'office_shelf' } } as const
const OFFICE_BODY = { body: { scope: 'office_shelf' } } as const

const DOCUMENTS_ONLY = { kinds: ['document'], facets: false } as const

function documentSearchInput(given: OperationExample): OperationExample {
  const { q, topK, projectId, scope, ...rest } = (given.body ?? {}) as Record<string, unknown>
  return {
    query: { ...(projectId === undefined ? {} : { projectId }), ...(scope === undefined ? {} : { scope }), ...given.query },
    body: { ...rest, ...(q === undefined ? {} : { text: q }), ...(topK === undefined ? {} : { limit: topK }) },
  }
}

export const RENAMED_OPERATIONS: Readonly<Record<string, string | RenamedWithInput>> = {
  'job-list': 'task-list',
  'job-get': 'task-get',
  'job-create': 'task-create',
  'job-update': 'task-update',
  'job-delete': 'task-delete',
  'job-run': 'task-run-start',
  'job-run-list': 'project-task-run-list',
  'task-run-list': 'project-task-run-list',
  'task-review': 'task-run-review',
  'run-commission': 'task-run-commission',
  'run-get': 'task-run-get',
  'run-cancel': 'task-run-cancel',
  'run-document-add': 'task-run-document-add',
  'run-write-now': 'task-run-write-now',
  'document-quarantine-release': 'document-quarantine-allow',
  'document-quarantine-release-request': 'document-quarantine-allow-request',
  'project-document-list': 'document-list',
  'office-shelf-document-list': { to: 'document-list', input: OFFICE_QUERY },
  'office-shelf-document-summary': { to: 'document-summary-get', input: OFFICE_QUERY },
  'office-shelf-document-lookup': { to: 'document-by-name-resolve', input: OFFICE_BODY },
  'office-shelf-document-name-probe': { to: 'document-name-match', input: OFFICE_BODY },
  'office-shelf-document-revision-probe': { to: 'document-revision-candidates', input: OFFICE_BODY },
  'office-shelf-document-search': {
    to: 'workspace-search',
    input: { query: { scope: 'office_shelf' }, body: DOCUMENTS_ONLY },
    rewrite: documentSearchInput,
  },
  'document-search': { to: 'workspace-search', input: { body: DOCUMENTS_ONLY }, rewrite: documentSearchInput },
  'office-shelf-document-upload': { to: 'document-upload', input: { body: { fields: { scope: 'office_shelf' } } } },
  'office-shelf-document-delete': 'document-delete',
  'document-version-file-get': 'document-file-get',
  'piloti-ask-create': 'agent-ask-create',
  'piloti-ask-get': 'agent-ask-get',
  'piloti-ask-cancel': 'agent-ask-cancel',
  'piloti-change-undo': 'agent-change-undo',
}

export function renamedTo(name: string): string | undefined {
  const renamed = RENAMED_OPERATIONS[name]
  return typeof renamed === 'string' ? renamed : renamed?.to
}

export function findOperation(name: string): AgentOperation | undefined {
  const current = byName.get(name)
  if (current) return current
  const renamed = RENAMED_OPERATIONS[name]
  if (typeof renamed !== 'object') return byName.get(renamed ?? '')
  const op = byName.get(renamed.to)
  return op && { ...op, inputDefaults: renamed.input, ...(renamed.rewrite ? { rewriteInput: renamed.rewrite } : {}) }
}
