import { apiConfig } from './config'

const getBaseUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '' : apiConfig.baseUrl
}

export interface DataSourceFromAPI {
  id: string
  name: string
  description?: string
  category?: 'web' | 'enterprise' | 'storage' | 'collaboration'
  default_enabled?: boolean
  requires_auth?: boolean
}

export interface DataSourcesResponse {
  data_sources: DataSourceFromAPI[]
  knowledge_layer: boolean
  vlm_available: boolean
}

export interface DataSourcesClientOptions {
  authToken?: string
}

async function handleApiError(response: Response, context: string): Promise<never> {
  const error = await response.json().catch(() => ({}))
  throw new Error(error?.error?.message || `${context}: ${response.statusText}`)
}

export const createDataSourcesClient = (options: DataSourcesClientOptions = {}) => {
  const { authToken } = options

  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }
    return headers
  }

  return {
    async getDataSources(signal?: AbortSignal): Promise<DataSourcesResponse> {
      const baseUrl = getBaseUrl()
      const url = baseUrl ? `${baseUrl}/v1/data_sources` : '/api/v1/data_sources'
      const response = await fetch(url, {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to fetch data sources')
      }

      const data = await response.json()

      const rawDataSources: DataSourceFromAPI[] = Array.isArray(data)
        ? data
        : (data.data_sources ?? [])

      const vlmAvailable = !Array.isArray(data) && data?.vlm_available === true

      const hasKnowledgeLayer = rawDataSources.some((source) => source.id === 'knowledge_layer')

      const filteredDataSources = rawDataSources.filter((source) => source.id !== 'knowledge_layer')

      return {
        data_sources: filteredDataSources,
        knowledge_layer: hasKnowledgeLayer,
        vlm_available: vlmAvailable,
      }
    },
  }
}

export type DataSourcesClient = ReturnType<typeof createDataSourcesClient>
