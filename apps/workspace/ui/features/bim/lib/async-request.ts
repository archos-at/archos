export interface AsyncState<T> {
  data: T | null
  isLoading: boolean
  error: string | null
}

export const IDLE = { data: null, isLoading: false, error: null } as const

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${response.status}`)
  return (await response.json()) as T
}
