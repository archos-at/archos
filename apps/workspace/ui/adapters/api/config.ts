import { getBackendUrl } from '@/lib/backend-url'

interface ApiConfig {
  baseUrl: string
  healthUrl: string
  timeout: number
  documentsBaseUrl: string
  collectionsUrl: string
}

const isServer = typeof window === 'undefined'

export const getWebSocketUrl = async (): Promise<string> => {
  if (isServer) {
    const chatUrl = (process.env.BACKEND_CHAT_URL ?? '').trim().replace(/\/$/, '')
    if (!chatUrl) throw new Error('BACKEND_CHAT_URL is required to open the chat socket from the server')
    return `${chatUrl.replace(/^http/, 'ws')}/websocket`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/websocket`
}

export const apiConfig: ApiConfig = {
  baseUrl: getBackendUrl(),
  healthUrl: `${getBackendUrl()}/health`,
  timeout: 30000,
  documentsBaseUrl: `${getBackendUrl()}/v1`,
  collectionsUrl: `${getBackendUrl()}/v1/collections`,
}

export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const url = isServer ? apiConfig.healthUrl : '/api/health'
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
