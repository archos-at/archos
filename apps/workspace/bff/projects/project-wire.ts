import { z } from 'zod'
import { monthSchema } from './month'
import { PROJECT_OUTCOMES, type ProjectStatus } from './project-status'

export const renameProjectSchema = z.object({
  name: z.string().min(1).max(255).trim(),
})

export const deleteProjectSchema = z.object({
  confirmName: z.string().min(1),
})

export const sameAddressQuerySchema = z.object({
  label: z.string().trim().min(3).max(300),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
})

export const projectStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active') }).strict(),
  z.object({ status: z.literal('paused') }).strict(),
  z
    .object({
      status: z.literal('closed'),
      outcome: z.enum(PROJECT_OUTCOMES),
      endedOn: monthSchema,
    })
    .strict(),
])

export const listProjectsQuerySchema = z.object({
  view: z.enum(['summary', 'full']).optional(),
  nameContains: z.string().trim().min(1).max(200).optional(),
})
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>

export interface ProjectSummary {
  id: string
  name: string
  status: ProjectStatus
  projectName: string | null
  siteAddress: string | null
  createdAt: Date
  pausedAt: Date | null
  closedAt: Date | null
}
