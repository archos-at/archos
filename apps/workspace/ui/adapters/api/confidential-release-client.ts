import { z } from 'zod'

const ReleaseSchema = z.object({ enabled: z.boolean() })

async function request(init: RequestInit): Promise<boolean> {
  const response = await fetch('/api/organization/confidential-release', init)
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return ReleaseSchema.parse(await response.json()).enabled
}

export function getConfidentialRelease(): Promise<boolean> {
  return request({ method: 'GET' })
}

export function saveConfidentialRelease(enabled: boolean): Promise<boolean> {
  return request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
}
