import type { PlannedAction, PlannedFile } from './folder-upload-plan'

type EffectiveAction = Exclude<PlannedAction, 'update'> | 'revision' | 'skipped'

export function effectiveAction(file: PlannedFile, includeUpdates: boolean): EffectiveAction {
  if (file.action === 'update') return includeUpdates ? 'revision' : 'skipped'
  if (file.action === 'new' && file.revisionOf?.chosen) return 'revision'
  return file.action
}
