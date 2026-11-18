import { z } from 'zod'
import type { UsageOverview } from './service'

export const platformOrgBudgetPutSchema = z.object({
  unit: z.enum(['credit', 'token']),
  dailyLimit: z.number().finite().min(0).max(99_999_999.9999).nullable(),
  monthlyLimit: z.number().finite().min(0).max(99_999_999.9999).nullable(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict()

export type PlatformOrgBudgetInput = z.infer<typeof platformOrgBudgetPutSchema>

export interface PlatformOrgBudget {
  organizationId: string
  unit: PlatformOrgBudgetInput['unit']
  dailyLimit: number | null
  monthlyLimit: number | null
  explicit: boolean
  dayUsed: number
  monthUsed: number
  canManage: boolean
}

export interface PlatformOrgUsage {
  organization: { id: string; name: string | null }
  usage: UsageOverview
  members: Array<{ id: string; email: string; name: string | null }>
}
