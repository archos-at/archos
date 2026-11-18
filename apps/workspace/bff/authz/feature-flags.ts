import type { UserSession } from '@/lib/auth/types'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { NextResponse } from 'next/server'
import { featureDisabledProblem } from './feature-disabled'
import { LEGACY_FLAG_KEYS } from './legacy-feature-flags'

export const FEATURE_FLAGS = {
  modelConfiguration: 'runtime-model-config',
  deepResearch: 'deep-research',
  taskAutomation: 'task-automation',
  projectKnowledgePage: 'project-knowledge-page',
  byokLlm: 'byok-llm',
  webSearch: 'web-search',
  imageUpload: 'image-upload',
  wizardConflictCheck: 'wizard-conflict-check',
  collaboration: 'collaboration',
  ifcModels: 'ifc-models',
  agentAuthoredDocuments: 'agent-authored-documents',
  skills: 'skills',
  mailImport: 'mail-import',
  memoryReflection: 'memory-reflection',
  postAnswerFollowUps: 'post-answer-follow-ups',
  threadReplies: 'agent-thread-replies',
  agentActs: 'agent-direct-edits',
  agentNotices: 'revision-suggestions',
  agentMcp: 'agent-mcp',
  agentMcpAccess: 'agent-mcp-access',
  agentMcpSecrets: 'agent-mcp-secrets',
  agentMcpControls: 'agent-mcp-controls',
  platformAgentMcp: 'platform-agent-mcp',
  agentAsk: 'agent-requests',
  folderCards: 'folder-cards',
  officeConventions: 'office-conventions',
  licensedSeam: 'licensed-seam',
  inboundMail: 'inbound-mail',
  siteResolution: 'site-resolution',
  sourceMonitors: 'source-monitors',
  officeStandards: 'office-standards',
} as const

export type KnownFeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS]

export const FLAG_KINDS: Readonly<Record<KnownFeatureFlag, 'entitlement' | 'rollout'>> = {
  'runtime-model-config': 'entitlement',
  'deep-research': 'entitlement',
  'task-automation': 'entitlement',
  'byok-llm': 'entitlement',
  collaboration: 'entitlement',
  skills: 'entitlement',
  'mail-import': 'entitlement',
  'agent-thread-replies': 'entitlement',
  'agent-direct-edits': 'entitlement',
  'revision-suggestions': 'entitlement',
  'agent-mcp': 'entitlement',
  'agent-mcp-access': 'entitlement',
  'agent-mcp-secrets': 'entitlement',
  'agent-mcp-controls': 'entitlement',
  'platform-agent-mcp': 'entitlement',
  'agent-requests': 'entitlement',
  'folder-cards': 'entitlement',
  'office-conventions': 'entitlement',
  'licensed-seam': 'entitlement',
  'inbound-mail': 'entitlement',
  'site-resolution': 'rollout',
  'source-monitors': 'entitlement',
  'office-standards': 'entitlement',
  'web-search': 'rollout',
  'project-knowledge-page': 'rollout',
  'image-upload': 'rollout',
  'wizard-conflict-check': 'rollout',
  'ifc-models': 'rollout',
  'agent-authored-documents': 'rollout',
  'memory-reflection': 'rollout',
  'post-answer-follow-ups': 'rollout',
}

export const REGISTRY_FLAG_SLUGS: readonly KnownFeatureFlag[] = Object.values(FEATURE_FLAGS)

export function flagsFromWorkOS(): boolean {
  return isAuthRequired()
}

export function unauthenticatedDefault(flag: KnownFeatureFlag): boolean {
  return FLAG_KINDS[flag] === 'rollout'
}

export function acceptedFlagKeysOf(flag: KnownFeatureFlag): readonly string[] {
  const legacy = LEGACY_FLAG_KEYS[flag]
  return legacy === undefined ? [flag] : [flag, legacy]
}

export function isFeatureEnabled(
  session: Pick<UserSession, 'featureFlags'>,
  flag: KnownFeatureFlag
): boolean {
  if (!flagsFromWorkOS()) return unauthenticatedDefault(flag)
  const held = session.featureFlags
  if (held === null) return false // stale token — re-auth picks flags up
  return acceptedFlagKeysOf(flag).some((key) => held.includes(key))
}

export function isProjectKnowledgePageEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.projectKnowledgePage)
}

export function isMailImportEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.mailImport)
}

export function isInboundMailEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.inboundMail)
}

export function isOfficeStandardsEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.officeStandards)
}

export function isAgentWakesEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.threadReplies)
}

export function isAgentAskEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.agentAsk)
}

export function isAgentNoticesEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.agentNotices)
}

export function isAgentActsEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.agentActs)
}

export function isCollaborationEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.collaboration)
}

export function isIfcModelsEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.ifcModels)
}

export function isAgentAuthoredDocumentsEnabled(
  session: Pick<UserSession, 'featureFlags'>
): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.agentAuthoredDocuments)
}

export function requireCollaborationEnabled(
  session: Pick<UserSession, 'featureFlags'>
): Response | null {
  return requireFeature(session, FEATURE_FLAGS.collaboration)
}

export function isSkillsEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.skills)
}

export function requireSkillsEnabled(session: Pick<UserSession, 'featureFlags'>): Response | null {
  return requireFeature(session, FEATURE_FLAGS.skills)
}

export function isTaskAutomationEnabled(session: Pick<UserSession, 'featureFlags'>): boolean {
  return isFeatureEnabled(session, FEATURE_FLAGS.taskAutomation)
}

export function requireTaskAutomationEnabled(
  session: Pick<UserSession, 'featureFlags'>
): Response | null {
  return requireFeature(session, FEATURE_FLAGS.taskAutomation)
}

export function requireFeature(
  session: Pick<UserSession, 'featureFlags'>,
  flag: KnownFeatureFlag
): Response | null {
  if (isFeatureEnabled(session, flag)) return null
  return NextResponse.json(featureDisabledProblem(flag), { status: 403, headers: { 'Content-Type': 'application/problem+json' } })
}
