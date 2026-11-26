import type { PlannedAction, PlannedFile } from './folder-upload-plan'

type EffectiveAction = Exclude<PlannedAction, 'update' | 'collision'> | 'revision' | 'keepBoth' | 'skipped'

export function effectiveAction(file: PlannedFile): EffectiveAction {
  if (file.conflict) {
    if (file.conflict.choice === 'skip') return 'skipped'
    return file.conflict.choice === 'replace' ? 'revision' : 'keepBoth'
  }
  if (file.action === 'update' || file.action === 'collision') return 'skipped'
  if (file.action === 'new' && file.revisionOf?.chosen) return 'revision'
  return file.action
}
