import 'server-only'

import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { layerSchema, resolveField } from './layered-schema'
import { unknownOperation } from './discovery-call'
import { inputSchemaOf } from './discovery-input-schema'
import { failure, success } from './discovery-results'
import { annotationsOf } from './operation'
import { findVisibleBackendOperation, findVisibleOperation } from './policy'
import { type McpCallContext, recordOperationCalled } from './telemetry'

const describeInput = z.object({ name: z.string().min(1), field: z.string().min(1).max(200).optional() })

function schemaView(opName: string, schema: JsonSchemaNode, field: string | undefined): { shown: Record<string, unknown> } | { refusal: CallToolResult } {
  const root = schema as Record<string, unknown>
  const resolved = field === undefined ? { node: root } : resolveField(root, field)
  if ('error' in resolved) return { refusal: failure(`describe-operation ${opName}: ${resolved.error}`) }
  const { schema: inputSchema, layered } = layerSchema(resolved.node, field ?? '')
  return { shown: { ...(field === undefined ? {} : { field }), ...(layered ? { layered: true } : {}), inputSchema } }
}

export function describeOperation(ctx: McpCallContext, args: unknown): CallToolResult {
  const startedAt = Date.now()
  const parsed = describeInput.safeParse(args)
  if (!parsed.success) return failure('describe-operation needs { name, field? }.')
  const { field } = parsed.data
  const backend = findVisibleBackendOperation(ctx.principal, parsed.data.name)
  if (backend) {
    recordOperationCalled(ctx, { operation: 'describe-operation', domain: backend.domain, decision: 'run', status: 200, startedAt })
    const view = schemaView(backend.name, backend.inputSchema as JsonSchemaNode, field)
    if ('refusal' in view) return view.refusal
    return success({
      name: backend.name,
      domain: backend.domain,
      summary: backend.summary,
      description: backend.description,
      annotations: backend.annotations,
      sensitivity: null,
      ...view.shown,
    })
  }
  const op = findVisibleOperation(ctx.principal, parsed.data.name)
  recordOperationCalled(ctx, {
    operation: 'describe-operation',
    domain: op?.domain ?? null,
    decision: op ? 'run' : 'refused',
    status: op ? 200 : 404,
    startedAt,
  })
  if (!op) return unknownOperation(ctx, parsed.data.name)
  const view = schemaView(op.name, inputSchemaOf(op), field)
  if ('refusal' in view) return view.refusal
  return success({
    name: op.name,
    domain: op.domain,
    summary: op.summary,
    description: op.description,
    annotations: annotationsOf(op),
    sensitivity: op.sensitivity ?? null,
    ...view.shown,
  })
}
