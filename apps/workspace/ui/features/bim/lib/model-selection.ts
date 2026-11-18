import type { BimModelHeaderView } from './model-header'

export function pickDefaultModel(models: readonly BimModelHeaderView[]): BimModelHeaderView | null {
  return models.find((model) => model.status === 'ready') ?? models[0] ?? null
}

export function resolveModelByFilename(
  models: readonly BimModelHeaderView[],
  filename: string | null
): { model: BimModelHeaderView | null; ambiguous: boolean } {
  if (models.length === 0) return { model: null, ambiguous: false }
  if (!filename) return { model: pickDefaultModel(models), ambiguous: false }
  const needle = filename.toLowerCase()
  const exact = models.find((candidate) => candidate.filename.toLowerCase() === needle)
  if (exact) return { model: exact, ambiguous: false }
  const partial = models.filter((candidate) => candidate.filename.toLowerCase().includes(needle))
  if (partial.length === 1) return { model: partial[0] ?? null, ambiguous: false }
  return { model: null, ambiguous: partial.length > 1 }
}

export function notReadyModelStatus(
  models: readonly BimModelHeaderView[],
  filename: string | null
): 'extracting' | 'failed' | null {
  const pending = models.filter((candidate) => candidate.status !== 'ready')
  if (pending.length === 0) return null
  const needle = (filename ?? '').toLowerCase()
  const named = needle
    ? pending.filter((candidate) => candidate.filename.toLowerCase().includes(needle))
    : pending
  if (named.length === 0) return null
  return named.some((candidate) => candidate.status === 'failed') ? 'failed' : 'extracting'
}
