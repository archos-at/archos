import 'server-only'

import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { configuredAppOrigin } from '@/lib/app-origin'
import { PRODUCT_NAME } from '@/lib/brand'
import { withAiGeneratedMeta } from './ai-generated-meta'
import { type BackendOperation, type JsonSchemaObject, toMcpContent } from './backend-operations'
import { APP_TOOLS, APP_VIEWS } from './catalog/app-views'
import {
  type BinaryBody,
  MAX_INLINE_BYTES,
  MAX_TEXT_BYTES,
  type OperationInput,
  type OperationResult,
  type OversizedBody,
  isBinaryBody,
  isOversizedBody,
  isRedirectBody,
} from './dispatch'
import { refusalResult } from './door-problem'
import { withLinks } from './links'
import type { AgentOperation } from './operation'

export const MAX_RESULT_CHARS = 40_000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const GENERIC_NARROWING_HINT = 'Narrow the call to page through it: pass a smaller limit or filters in input.query, or fetch one item by id.'

export function narrowingHint(op: { readonly query?: z.ZodObject; readonly inputSchema?: JsonSchemaObject }): string {
  const names = op.inputSchema
    ? Object.keys(op.inputSchema.properties ?? {}).filter((name) => name !== 'projectId')
    : Object.keys(op.query?.shape ?? {})
  if (names.length === 0) {
    return (
      'This operation has no limit or filter, so its answer cannot be narrowed here. ' +
      'Use a narrower operation (search-operations with this domain lists them), or one that fetches a single item by id.'
    )
  }
  const where = op.inputSchema ? 'in input' : 'in input.query'
  return `Narrow the call with the parameters this operation takes (${names.join(', ')}) ${where}, or fetch one item by id with a narrower operation.`
}

function renderText(value: unknown, hint = GENERIC_NARROWING_HINT): { text: string; truncated: boolean } {
  const full = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'null')
  if (full.length <= MAX_RESULT_CHARS) return { text: full, truncated: false }
  const note =
    `\n\n[Truncated: showing ${MAX_RESULT_CHARS} of ${full.length} characters. ` +
    `${hint}]`
  return { text: full.slice(0, MAX_RESULT_CHARS) + note, truncated: true }
}

const VIEW_DATA_OPERATIONS: ReadonlySet<string> = new Set<string>([
  ...APP_VIEWS.flatMap((view) => view.drawsResultOf),
  ...APP_TOOLS.map((tool) => tool.operation),
])

export function success(value: unknown, hint?: string, keepStructured = false): CallToolResult {
  const { text, truncated } = renderText(value, hint)
  const result: CallToolResult = { content: [{ type: 'text', text }] }
  if (!truncated || keepStructured) result.structuredContent = isRecord(value) ? value : { result: value }
  return result
}

export function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function sizeText(bytes: number | null): string {
  if (bytes === null) return 'an unknown size'
  if (bytes < 1024) return `${bytes} bytes`
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

const SAFE_URI_SEGMENT = /[^\w.-]+/g

function binaryResult(opName: string, file: BinaryBody): CallToolResult {
  const mimeType = file.contentType?.split(';')[0]?.trim() || 'application/octet-stream'
  const label = file.filename ? `"${file.filename}", ` : ''
  if (file.tooLarge || file.base64 === undefined) {
    return {
      content: [
        {
          type: 'text',
          text:
            `The file (${label}${mimeType}, ${sizeText(file.bytes)}) is over the ${sizeText(MAX_INLINE_BYTES)} ` +
            'limit for sending a file in a tool result, so it was not sent. ' +
            'For a document, read its text in pages with the passage reader (named by its file name), or call document-download for a ' +
            'time-limited link the person can open. Otherwise ask the person to download it in ' + PRODUCT_NAME + '.',
        },
      ],
    }
  }
  const name = (file.filename ?? 'result').replace(SAFE_URI_SEGMENT, '_')
  return {
    content: [
      { type: 'text', text: `Returned ${label}${mimeType}, ${sizeText(file.bytes)}, as the attached resource.` },
      { type: 'resource', resource: { uri: `workspace://operation/${opName}/${name}`, mimeType, blob: file.base64 } },
    ],
  }
}

function redirectResult(opName: string, location: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `The file is at a time-limited link. Open it soon: the link expires, and ${opName} mints a fresh one.`,
      },
      { type: 'resource_link', uri: location, name: opName, description: 'Expires shortly; request it again when needed.' },
    ],
  }
}

function oversizedResult(op: AgentOperation | BackendOperation, body: OversizedBody): CallToolResult {
  const opName = op.name
  return failure(
    `${opName} answered with more than ${sizeText(MAX_TEXT_BYTES)} of ${body.contentType || 'text'}` +
      (body.bytes === null ? '' : ` (${sizeText(body.bytes)})`) +
      `, so it was not read. ${narrowingHint(op)}`
  )
}

export function fromOperationResult(
  op: AgentOperation,
  result: OperationResult,
  input: OperationInput = {},
  origin: string | null = configuredAppOrigin(),
  forView = false,
): CallToolResult {
  if (isOversizedBody(result.body)) return oversizedResult(op, result.body)
  if (!result.ok) return refusalResult(result)
  if (isBinaryBody(result.body)) return binaryResult(op.name, result.body)
  if (isRedirectBody(result.body)) return redirectResult(op.name, result.body.location)
  const keep = forView && VIEW_DATA_OPERATIONS.has(op.name)
  return withAiGeneratedMeta(op, result.body, success(withLinks(op, input, result.body, origin), narrowingHint(op), keep))
}

export function fromBackendResult(op: BackendOperation, result: OperationResult): CallToolResult {
  const hint = narrowingHint(op)
  if (isOversizedBody(result.body)) return oversizedResult(op, result.body)
  if (!result.ok) return refusalResult(result)
  const value = isRecord(result.body) && 'result' in result.body ? result.body.result : result.body
  if (!Array.isArray(value)) return success(value, hint)
  const content = toMcpContent(value).map((block) =>
    block.type === 'text' ? { type: 'text' as const, text: renderText(block.text, hint).text } : block,
  )
  return { content }
}
