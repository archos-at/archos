import 'server-only'

import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { failure, success } from './discovery-results'
import { type McpCallContext, recordOperationMissing } from './telemetry'

export const FRICTION_CATEGORIES = ['missing_operation', 'tool_description', 'input_schema', 'error_message', 'result_shape', 'other'] as const
export type FrictionCategory = (typeof FRICTION_CATEGORIES)[number]

const missingInput = z.object({
  description: z.string().min(1).max(2_000),
  category: z.enum(FRICTION_CATEGORIES).default('missing_operation'),
})

export function reportMissingOperation(ctx: McpCallContext, args: unknown): CallToolResult {
  const parsed = missingInput.safeParse(args)
  if (!parsed.success) {
    return failure(`report-missing-operation needs { description } of 1 to 2000 characters, and category one of ${FRICTION_CATEGORIES.join(', ')} when given.`)
  }
  recordOperationMissing(ctx, parsed.data.description, parsed.data.category)
  return success({ status: 'recorded' })
}
