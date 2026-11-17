import { z } from 'zod'
import { JOB_OUTPUTS, type JobOutput } from '@/lib/db/schema/jobs'
import { skillNameSchema, type KnownSkillAgent, type SkillSnapshot } from '@/lib/skills/types'
import { isValidCronExpression, isValidTimezone } from './schedule'

export const MAX_JOB_NAME_LENGTH = 200
export const AGENT_RUN_INPUT_MAX_CHARS = 48_000
export const MAX_JOB_PROMPT_LENGTH = 8000
export const MAX_DATA_SOURCES = 50
export const KNOWLEDGE_SOURCE_ID = 'knowledge_layer'
export const RIS_SOURCE_ID = 'ris'

export const ALWAYS_ON_SOURCE_IDS: readonly string[] = [KNOWLEDGE_SOURCE_ID, RIS_SOURCE_ID]

export const AGENT_FOR_OUTPUT: Record<JobOutput, KnownSkillAgent> = {
  chat: 'researcher',
  'deep-research': 'deep_researcher',
}

export function withAlwaysOnSources(dataSources: string[] | null): string[] | null {
  if (dataSources === null) return null
  const missing = ALWAYS_ON_SOURCE_IDS.filter((id) => !dataSources.includes(id))
  return [...missing, ...dataSources]
}

export function emptySkillSnapshot(): SkillSnapshot {
  return {} as SkillSnapshot
}

const jobNameSchema = z
  .string()
  .trim()
  .min(1, 'A job name is required.')
  .max(MAX_JOB_NAME_LENGTH, `Job names are at most ${MAX_JOB_NAME_LENGTH} characters.`)

export const jobPromptSchema = z
  .string()
  .trim()
  .min(1, 'A prompt is required.')
  .max(MAX_JOB_PROMPT_LENGTH, `Prompts are at most ${MAX_JOB_PROMPT_LENGTH} characters.`)

export const jobOutputSchema = z.enum(JOB_OUTPUTS)

const attachedSkillNameSchema = skillNameSchema.nullish()

const dataSourcesSchema = z.array(z.string().trim().min(1)).max(MAX_DATA_SOURCES)

const dueAtSchema = z.coerce.date().nullish()

function refineSchedule(
  value: { scheduleCron?: string | null; scheduleTimezone?: string; dueAt?: Date | null },
  ctx: z.RefinementCtx
): void {
  if (value.scheduleCron != null && value.dueAt != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dueAt'],
      message: 'A task runs on a schedule or once at a due time, not both.',
    })
  }
  const tz = value.scheduleTimezone ?? 'UTC'
  if (value.scheduleTimezone != null && !isValidTimezone(value.scheduleTimezone)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduleTimezone'],
      message: 'Unknown IANA timezone.',
    })
  }
  if (value.scheduleCron != null && !isValidCronExpression(value.scheduleCron, tz)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduleCron'],
      message: 'Invalid 5-field cron expression.',
    })
  }
}

export const createJobSchema = z
  .object({
    name: jobNameSchema,
    prompt: jobPromptSchema,
    skillName: attachedSkillNameSchema,
    dataSources: dataSourcesSchema.nullish(),
    enabled: z.boolean().optional(),
    scheduleCron: z.string().trim().min(1).nullish(),
    scheduleTimezone: z.string().trim().min(1).optional(),
    dueAt: dueAtSchema,
  })
  .superRefine(refineSchedule)

export type CreateJobInput = z.infer<typeof createJobSchema>

export const patchJobSchema = z
  .object({
    name: jobNameSchema.optional(),
    prompt: jobPromptSchema.optional(),
    skillName: attachedSkillNameSchema,
    dataSources: dataSourcesSchema.nullish(),
    enabled: z.boolean().optional(),
    scheduleCron: z.string().trim().min(1).nullish(),
    scheduleTimezone: z.string().trim().min(1).optional(),
    dueAt: dueAtSchema,
  })
  .superRefine(refineSchedule)

export type PatchJobInput = z.infer<typeof patchJobSchema>
