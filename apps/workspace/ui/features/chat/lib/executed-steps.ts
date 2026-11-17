import { skillActivityOf, skillLabel } from '@/features/skills/lib/skill-activity'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'

export interface ExecutedStep {
  key: string
  label: string
  prefix?: string
  mono?: string
  skill?: boolean
  running: boolean
}

const LEGAL_DATABASE = 'ris'

const TOOL_LABEL_KEYS: Record<string, string> = {
  web_search_tool: 'webSearch',
  advanced_web_search_tool: 'webSearch',
  ris_search_tool: LEGAL_DATABASE,
  ris_fetch_tool: LEGAL_DATABASE,
  law_lookup: LEGAL_DATABASE,
  ris_lookup_tool: LEGAL_DATABASE,
  ris_catalog_lookup_tool: LEGAL_DATABASE,
  knowledge_search: 'corpus',
  project_lookup: 'otherProjects',
  read_passage: 'reading',
  ifc_query: 'model',
  ifc_measure: 'measure',
  dxf_measure: 'measure',
  view_knowledge_image: 'drawing',
  surface_documents: 'documents',
  list_files: 'documents',
  remember: 'note',
  emit_card: 'card',
  compliance_check: 'compliance',
  write_file: 'draft',
  read_file: 'draft',
  edit_file: 'draft',
  ls: 'draft',
  file_draft: 'filing',
  submit_draft: 'filing',
  create_task: 'task',
  look: 'drawing',
  room: 'annotations',
  point: 'annotations',
  highlight: 'annotations',
  marks: 'annotations',
  mark: 'annotations',
  reply: 'annotations',
  document_annotations: 'annotations',
  propose_file_change: 'fileProposal',
  move_document: 'fileProposal',
  rename_document: 'fileProposal',
  create_folder: 'fileProposal',
  assign_document: 'fileProposal',
  set_doc_class: 'fileProposal',
  call: 'workspace',
}

export const stepNameLabel = (tool: string, t: (key: string) => string): string | null => {
  const key = TOOL_LABEL_KEYS[tool]
  return key ? t(`thinking.stepName.${key}`) : null
}

const skillChip = (
  step: Pick<StoredThinkingStep, 'kind' | 'skill' | 'detail' | 'turnEvent'>,
  t: (key: string) => string
): Pick<ExecutedStep, 'key' | 'label' | 'prefix' | 'mono'> | null => {
  const activity = skillActivityOf(step)
  if (!activity || activity.phase === 'offered' || activity.hidden) return null
  const named = skillLabel(activity)
  if (!named) return null
  const key = `skill:${activity.name ?? named.text}`
  const template = t('thinking.stepName.skill')
  const label = template.replace('{name}', named.text)
  if (!named.mono) return { key, label }
  return { key, label, prefix: template.split('{name}')[0].trim(), mono: named.text }
}

const ESTATE_LABEL_KEYS: Record<string, string> = {
  read_file: 'reading',
  ls: 'documents',
  glob: 'documents',
  grep: 'documents',
}

const OFF_ESTATE: ReadonlySet<string> = new Set(['drafts', 'skills'])

const toolLabelKey = (tool: string, mount: unknown): string | undefined => {
  if (typeof mount === 'string' && ESTATE_LABEL_KEYS[tool]) {
    if (mount === 'skills') return undefined
    return OFF_ESTATE.has(mount) ? 'draft' : ESTATE_LABEL_KEYS[tool]
  }
  return TOOL_LABEL_KEYS[tool]
}

const toolChip = (
  step: Pick<StoredThinkingStep, 'kind' | 'tool' | 'detail'>,
  t: (key: string) => string
): Pick<ExecutedStep, 'key' | 'label'> | null => {
  if (step.kind !== 'tool' || !step.tool) return null
  const key = toolLabelKey(step.tool, step.detail?.mount)
  const label = key ? t(`thinking.stepName.${key}`) : null
  return label ? { key: label, label } : null
}

export const deriveExecutedSteps = (
  steps: readonly Pick<
    StoredThinkingStep,
    'kind' | 'tool' | 'skill' | 'detail' | 'turnEvent' | 'isComplete' | 'scope'
  >[],
  t: (key: string) => string
): ExecutedStep[] => {
  const seen = new Map<string, ExecutedStep>()
  for (const step of steps) {
    if (step.scope === 'deep') continue
    const chip = step.kind === 'skill' ? skillChip(step, t) : toolChip(step, t)
    if (!chip) continue
    const existing = seen.get(chip.key)
    if (existing) {
      existing.running = !step.isComplete
      continue
    }
    seen.set(chip.key, {
      ...chip,
      ...(step.kind === 'skill' ? { skill: true } : {}),
      running: !step.isComplete,
    })
  }
  return Array.from(seen.values())
}
