import { modernizeTurnEventKey } from '@/lib/conversations/legacy-turn-event'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { fileFormatNoun } from './file-format'

export const TURN_EVENT_KEYS: Record<string, string> = {
  'status.documents.officeShelf': 'thinking.turnStatus.',
  'status.documents.project': 'thinking.turnStatus.',
  'status.documents.session': 'thinking.turnStatus.',
  'status.documents.several': 'thinking.turnStatus.',
  'status.documents.waiting': 'thinking.turnStatus.',
  'status.retrieval.withQuery': 'thinking.turnStatus.',
  'status.retrieval.plain': 'thinking.turnStatus.',
  'status.retrieval.clause': 'thinking.turnStatus.',
  'status.retrieval.page': 'thinking.turnStatus.',
  'status.retrieval.requery': 'thinking.turnStatus.',
  'status.action.remember': 'thinking.turnStatus.',
  'status.action.card': 'thinking.turnStatus.',
  'status.action.draftList': 'thinking.turnStatus.',
  'status.action.draftRead': 'thinking.turnStatus.',
  'status.action.draftWrite': 'thinking.turnStatus.',
  'status.action.draftEdit': 'thinking.turnStatus.',
  'status.action.fileProposal': 'thinking.turnStatus.',
  'status.action.draftFiled': 'thinking.turnStatus.',
  'status.action.codeRun': 'thinking.turnStatus.',
  'status.action.fileMake': 'thinking.turnStatus.',
  'status.action.filesMake': 'thinking.turnStatus.',
  'status.action.fileEdit': 'thinking.turnStatus.',
  'status.action.fileCheck': 'thinking.turnStatus.',
  'status.action.fileRetry': 'thinking.turnStatus.',
  'status.action.calculation': 'thinking.turnStatus.',
  'status.action.taskCreated': 'thinking.turnStatus.',
  'status.action.annotationsRead': 'thinking.turnStatus.',
  'status.action.annotationsPropose': 'thinking.turnStatus.',
  'status.action.annotationsSet': 'thinking.turnStatus.',
  'status.action.annotationsUpdate': 'thinking.turnStatus.',
  'status.action.annotationsDelete': 'thinking.turnStatus.',
  'status.action.annotationsReply': 'thinking.turnStatus.',
  'status.action.look': 'thinking.turnStatus.',
  'status.action.workspaceCall': 'thinking.turnStatus.',
  'status.synthesis': 'thinking.turnStatus.',
  'status.citations': 'thinking.turnStatus.',
  'status.repair': 'thinking.turnStatus.',
  'status.escalation': 'thinking.turnStatus.',
  'skill.activated': 'thinking.',
}

export const FOLD_EVENT_KEYS: Record<string, string> = {
  'status.steer.received': 'thinking.turnStatus.',
  'status.steer.applied': 'thinking.turnStatus.',
}

const FORMAT_KEYS = new Set(['status.action.fileMake', 'status.action.fileRetry'])

const CORPUS_KEYS = new Set(['status.retrieval.withQuery', 'status.retrieval.plain'])

const CORPUS_IDS = new Set(['knowledge', 'ris', 'web', 'documents', 'ifc', 'otherProjects'])

export type StepEventTranslator = (
  key: string,
  vars?: Record<string, string | number>
) => string

const corpusPhrase = (raw: string, t: StepEventTranslator): string | null => {
  const named = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => CORPUS_IDS.has(id))
    .map((id) => t(`thinking.turnStatus.corpus.${id}`))
  if (named.length === 0) return null
  return named.join(t('thinking.turnStatus.corpusJoin'))
}

export const renderTurnEventKey = (
  storedKey: string,
  values: Record<string, string> | undefined,
  t: StepEventTranslator
): string | null => {
  const key = modernizeTurnEventKey(storedKey)
  const prefix = TURN_EVENT_KEYS[key] ?? FOLD_EVENT_KEYS[key]
  if (prefix === undefined) return null

  const vars: Record<string, string> = { ...(values ?? {}) }
  if (CORPUS_KEYS.has(key)) {
    const phrase = corpusPhrase(vars.corpus ?? '', t)
    if (!phrase) return null
    vars.corpus = phrase
  }
  if (FORMAT_KEYS.has(key)) vars.format = fileFormatNoun(vars.format ?? '', t)

  const rendered = t(`${prefix}${key}`, vars).trim()
  return rendered && rendered !== `${prefix}${key}` ? rendered : null
}

export const stepEventLiveText = (step: Pick<StoredThinkingStep, 'turnEvent'>, t: StepEventTranslator): string | null =>
  step.turnEvent ? renderTurnEventKey(step.turnEvent.key, step.turnEvent.values, t) : null
