import { createDocumentStores, MockStore } from './documents-stores'

export enum RelationType {
  BELONGS_TO = 'BELONGS_TO',
}

class SimpleMockDatabase {
  model = {
    documents: createDocumentStores(),
  }

  private relations = new Map<string, Set<string>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private relationKey(source: any, relationship: RelationType): string {
    const id = source.name ?? source.file_id ?? source.job_id ?? JSON.stringify(source)
    return `${id}::${relationship}`
  }

  relate({
    source,
    relationship,
    target,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: any
    relationship: RelationType
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: any
  }): void {
    const key = this.relationKey(source, relationship)
    if (!this.relations.has(key)) {
      this.relations.set(key, new Set())
    }
    const targetId = target.name ?? target.file_id ?? target.job_id ?? JSON.stringify(target)
    this.relations.get(key)!.add(targetId)
  }

  getRelated<T>({
    source,
    relationship,
    target,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: any
    relationship: RelationType
    target: MockStore<T>
  }): T[] {
    const key = this.relationKey(source, relationship)
    const relatedIds = this.relations.get(key)
    if (!relatedIds) return []

    const results: T[] = []
    for (const id of relatedIds) {
      const item = target.getById(id)
      if (item) results.push(item)
    }
    return results
  }
}

let db = new SimpleMockDatabase()

export const getDb = () => db

export const resetDatabase = () => {
  db = new SimpleMockDatabase()
}
