import { apiConfig } from './config'
import {
  CollectionInfoSchema,
  FileInfoSchema,
  FileListResponseSchema,
  IngestionJobStatusSchema,
  type CollectionInfo,
  type FileInfo,
  type IngestionJobStatus,
} from './documents-schemas'

const getCollectionsUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '/api/v1/collections' : apiConfig.collectionsUrl
}

const getDocumentsBaseUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '/api/v1' : apiConfig.documentsBaseUrl
}

export interface DocumentsClientOptions {
  authToken?: string
}

async function handleApiError(response: Response, context: string): Promise<never> {
  const error = await response.json().catch(() => ({}))
  throw new Error(error?.error?.message || `${context}: ${response.statusText}`)
}

export const createDocumentsClient = (options: DocumentsClientOptions = {}) => {
  const { authToken } = options

  const getHeaders = (includeContentType = true): Record<string, string> => {
    const headers: Record<string, string> = {}
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }
    if (includeContentType) {
      headers['Content-Type'] = 'application/json'
    }
    return headers
  }

  return {

    async createCollection(name: string, description?: string): Promise<CollectionInfo> {
      const response = await fetch(getCollectionsUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, description }),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to create collection')
      }

      const data = await response.json()
      return CollectionInfoSchema.parse(data)
    },

    async getCollection(name: string, signal?: AbortSignal): Promise<CollectionInfo | null> {
      const response = await fetch(`${getCollectionsUrl()}/${name}`, {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        await handleApiError(response, 'Failed to get collection')
      }

      const data = await response.json()
      return CollectionInfoSchema.parse(data)
    },

    async listFiles(collectionName: string, signal?: AbortSignal): Promise<FileInfo[]> {
      const response = await fetch(`${getCollectionsUrl()}/${collectionName}/documents`, {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to list files')
      }

      const data = await response.json()

      if (Array.isArray(data)) {
        return data.map((file) => FileInfoSchema.parse(file))
      }

      const validated = FileListResponseSchema.parse(data)
      return validated.files
    },

    async getJobStatus(jobId: string, signal?: AbortSignal): Promise<IngestionJobStatus | null> {
      const response = await fetch(`${getDocumentsBaseUrl()}/documents/${jobId}/status`, {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        await handleApiError(response, 'Failed to get job status')
      }

      const data = await response.json()
      return IngestionJobStatusSchema.parse(data)
    },
  }
}

export type DocumentsClient = ReturnType<typeof createDocumentsClient>
