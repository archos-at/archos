import { z } from 'zod'
import { LLM_CREDENTIAL_PROVIDERS } from './providers'

export const createCredentialSchema = z.object({
  provider: z.enum(LLM_CREDENTIAL_PROVIDERS),
  label: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  apiKey: z.string().min(8).max(512),
  rotatedFrom: z.guid().nullable().optional(),
})

export const providerModeSchema = z.object({
  mode: z.enum(['byok', 'platform']),
})
