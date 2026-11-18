import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpUiResourceMeta } from '@modelcontextprotocol/ext-apps'
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/server'
import { toJsonSchema } from '@/lib/api/zod-json-schema'
import { findOperation } from './catalog'
import { APP_TOOLS, APP_VIEWS, type AppTool, type AppToolRefusal, type AppView } from './catalog/app-views'
import { executeOperation, fromOperationResult } from './discovery'
import { RESOURCE_ICONS } from './icons'
import type { OperationInput } from './dispatch'
import { offersAppViews } from './app-host'
import { audienceOf, isAppToolFor, isOnDoor } from './exposure'
import type { AgentOperation } from './operation'
import type { McpCallContext } from './telemetry'
import { PRODUCT_NAME } from '@/lib/brand'

export { UI_EXTENSION, appHostOf, declaresMcpApps, offersAppViews } from './app-host'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const VIEW_UI_META: McpUiResourceMeta = {
  csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
  permissions: {},
  prefersBorder: false,
}

export const VIEWS_DIR = join(process.cwd(), 'mcp-app-views')

const documents = new Map<string, Promise<string>>()

export function viewDocument(view: Pick<AppView, 'file'>, dir: string = VIEWS_DIR): Promise<string> {
  const key = join(dir, view.file)
  let read = documents.get(key)
  if (!read) {
    read = readFile(key, 'utf8').catch((error: unknown) => {
      documents.delete(key)
      throw new Error(`The view ${view.file} is not built (run \`bun run build:mcp-apps\`): ${(error as Error).message}`)
    })
    documents.set(key, read)
  }
  return read
}

export function viewOf(operation: string): AppView | undefined {
  return APP_VIEWS.find((view) => (view.drawsResultOf as readonly string[]).includes(operation))
}

export function viewMetaOf(ctx: Pick<McpCallContext, 'principal' | 'appHost'>, operation: string): { ui: { resourceUri: string } } | undefined {
  const view = offersAppViews(ctx) ? viewOf(operation) : undefined
  return view ? { ui: { resourceUri: view.uri } } : undefined
}

export const VIEW_TOOL_NOTE =
  ' Called as its own tool, a host that renders MCP Apps shows the proposal as ' + PRODUCT_NAME + '’s card, where the person applies or discards it.'

function registerViewResources(server: McpServer): void {
  for (const view of APP_VIEWS) {
    registerAppResource(
      server,
      view.name,
      view.uri,
      { title: view.title, description: view.description, mimeType: RESOURCE_MIME_TYPE, icons: RESOURCE_ICONS[view.name], _meta: { ui: VIEW_UI_META } },
      async (): Promise<ReadResourceResult> => ({
        contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewDocument(view), _meta: { ui: VIEW_UI_META } }],
      }),
    )
  }
}

function refused(result: CallToolResult, refusal: AppToolRefusal): CallToolResult {
  return { ...result, isError: true, structuredContent: { status: refusal.status, ...(refusal.code ? { code: refusal.code } : {}) } }
}

const notOffered = (tool: AppTool): CallToolResult =>
  refused({ content: [{ type: 'text', text: `${tool.name} is not offered on this connection.` }] }, { status: 404, code: 'NOT_FOUND' })

function inputOf(tool: AppTool, args: Record<string, unknown>): OperationInput {
  const { id, ...rest } = args as { id: string } & Record<string, unknown>
  return tool.sendsBody ? { params: { id }, body: rest } : { params: { id } }
}

export async function runAppTool(ctx: McpCallContext, tool: AppTool, args: unknown): Promise<CallToolResult> {
  const op: AgentOperation | undefined = findOperation(tool.operation)
  if (!op || !isOnDoor(op.name) || !offersAppViews(ctx) || !isAppToolFor(audienceOf(ctx.principal), tool.name)) return notOffered(tool)
  const parsed = tool.input.safeParse(args ?? {})
  if (!parsed.success) {
    const text = `${tool.name}: ${parsed.error.issues[0]?.message ?? 'invalid input'}`
    return refused({ content: [{ type: 'text', text }] }, { status: 400, code: 'VALIDATION_ERROR' })
  }
  const input = inputOf(tool, parsed.data)
  const decisionSource = ctx.appHost === 'declared' ? 'app' : 'app-unverified'
  const outcome = await executeOperation({ ...ctx, decisionSource }, op, input)
  if ('refusal' in outcome) return refused(outcome.refusal, outcome)
  const result = fromOperationResult(op, outcome.result, input, undefined, true)
  if (outcome.result.ok) return result
  const body = outcome.result.body
  const code = isRecord(body) && typeof body.code === 'string' ? body.code : undefined
  return refused(result, { status: outcome.result.status, ...(code ? { code } : {}) })
}

function registerAppTools(server: McpServer, ctx: McpCallContext): void {
  const audience = audienceOf(ctx.principal)
  for (const tool of APP_TOOLS) {
    if (!isAppToolFor(audience, tool.name)) continue
    registerAppTool(
      server,
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(toJsonSchema(tool.input) as Parameters<typeof fromJsonSchema>[0]),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { ui: { resourceUri: tool.view, visibility: ['app'] } },
      },
      (args: unknown) => runAppTool(ctx, tool, args),
    )
  }
}

export function registerAppViews(
  server: McpServer,
  ctx: McpCallContext,
  registerOperationTool: (op: AgentOperation) => void,
): void {
  if (!offersAppViews(ctx)) return
  registerViewResources(server)
  if (ctx.mode === 'search') {
    for (const view of APP_VIEWS) {
      for (const name of view.drawsResultOf) {
        const op = findOperation(name)
        if (op) registerOperationTool(op)
      }
    }
  }
  registerAppTools(server, ctx)
}
