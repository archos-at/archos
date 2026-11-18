import type { ZodType } from 'zod'
import {
  CollectionInfoSchema,
  FileInfoSchema,
  IngestionJobStatusSchema,
  type CollectionInfo,
  type FileInfo,
  type IngestionJobStatus,
} from '@/adapters/api/documents-schemas'

export class MockStore<T> {
  private data = new Map<string, T>()
  private getId: (item: T) => string
  private schema: ZodType<T, unknown>

  constructor(schema: ZodType<T, unknown>, getId: (item: T) => string) {
    this.schema = schema
    this.getId = getId
  }

  insert(item: T): T {
    const parsed = this.schema.parse(item) as T
    this.data.set(this.getId(parsed), parsed)
    return parsed
  }

  upsert(item: T): T {
    const parsed = this.schema.parse(item) as T
    this.data.set(this.getId(parsed), parsed)
    return parsed
  }

  remove(item: T): void {
    this.data.delete(this.getId(item))
  }

  getById(id: string): T | undefined {
    return this.data.get(id)
  }

  query(predicate: (item: T) => boolean): T[] {
    return Array.from(this.data.values()).filter(predicate)
  }
}

export const createDocumentStores = () => ({
  collections: new MockStore<CollectionInfo>(CollectionInfoSchema, (c) => c.name),
  files: new MockStore<FileInfo>(FileInfoSchema, (f) => f.file_id),
  jobs: new MockStore<IngestionJobStatus>(IngestionJobStatusSchema, (j) => j.job_id),
})

export type DocumentStores = ReturnType<typeof createDocumentStores>
