import 'server-only'

import {
  type ConversationAudience,
  type ReadCarries,
  READ_REFUSALS,
  conversationAudienceOf,
  judgeWorkspaceRead,
  ownRestrictingFolders,
  recordWorkspaceHandOut,
} from './conversation-audience'
import type { AgentOperation } from './operation'
import type { TargetInput } from './operation-targets'
import type { AgentPrincipal } from './principal'

export const AUDIENCE_READS: Readonly<Record<string, { carries: ReadCarries; reason: string }>> = {
  'document-get': { carries: 'document', reason: 'the document as its listing row, which every reader of it sees' },
  'document-text-get': { carries: 'document', reason: 'the document’s own text, which every reader of it reads' },
  'project-get': { carries: 'projectFacts', reason: 'the project row, gated by project:view alone' },
  'project-profile-get': { carries: 'projectFacts', reason: 'the project’s profile, gated by project:view alone' },
}

export const LINK_BEARING_OPERATIONS: ReadonlySet<string> = new Set([
  'document-download',
  'document-preview-get',
  'document-thumbnail-get',
  'bim-model-source-get',
])

export function sharedConversationReadRefusal(): string {
  return READ_REFUSALS.shared
}

export interface ReadGate {
  beforeRead(
    op: {
      readonly name: string
      readonly domain: AgentOperation['domain']
      readonly path?: AgentOperation['path']
      readonly spansProjects?: AgentOperation['spansProjects']
    },
    input?: TargetInput,
  ): Promise<string | null>
  mayHandOnLink(): Promise<boolean>
}

const gates = new WeakMap<AgentPrincipal, ReadGate>()

function buildGate(principal: AgentPrincipal): ReadGate {
  let audience: Promise<ConversationAudience | null> | undefined
  let ownFolders: Promise<string[]> | undefined
  const audienceOnce = () => (audience ??= conversationAudienceOf(principal))
  return {
    async beforeRead(op, input = {}) {
      const now = await audienceOnce()
      if (!now) return null
      const shape = op.path ? { path: op.path, spansProjects: op.spansProjects } : null
      const judged = await judgeWorkspaceRead(principal, now, shape, input, AUDIENCE_READS[op.name]?.carries, () =>
        (ownFolders ??= ownRestrictingFolders(principal)),
      )
      if ('refusal' in judged) return judged.refusal
      return (await recordWorkspaceHandOut(principal, now, judged.handOut)) ? null : READ_REFUSALS.audienceChanged
    },
    async mayHandOnLink() {
      const now = await audienceOnce()
      return !now || now.solo
    },
  }
}

export function readGateFor(principal: AgentPrincipal): ReadGate {
  let gate = gates.get(principal)
  if (!gate) {
    gate = buildGate(principal)
    gates.set(principal, gate)
  }
  return gate
}
