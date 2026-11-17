import type { BimModelHeader } from './repository'

export type BimModelShelf = 'office' | 'project'

export function modelShelf(model: Pick<BimModelHeader, 'projectId'>): BimModelShelf {
  return model.projectId === null ? 'office' : 'project'
}

export function withShelf<T extends Pick<BimModelHeader, 'projectId'>>(model: T): T & { shelf: BimModelShelf } {
  return { ...model, shelf: modelShelf(model) }
}
