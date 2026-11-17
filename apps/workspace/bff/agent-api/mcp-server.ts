import 'server-only'

import {
  type AuthInfo,
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  type ServerEventBus,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  fromJsonSchema,
  isLegacyRequest,
} from '@modelcontextprotocol/server'
import type {
  CallToolResult,
  InputRequiredResult,
  ServerContext,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from '@modelcontextprotocol/server'
import type { BackendOperation } from './backend-operations'
import { confirmThenRun, confirmationFor } from './confirmation'
import type { OperationInput } from './dispatch'
import {
  type MetaToolName,
  callOperationTool,
  catalogCallOf,
  describeOperation,
  inputSchemaOf,
  metaToolsFor,
  reportMissingOperation,
  runBackendOperation,
  runOperation,
  searchOperations,
} from './discovery'
import { type AgentOperation, annotationsOf } from './operation'
import { type AgentDoor, doorOfPrincipal, findVisibleOperation, visibleBackendOperations, visibleOperations } from './policy'
import type { AgentPrincipal } from './principal'
import { offersDoorGuide, offersProjectResource, readableProjectUris, registerDoorGuide } from './door'
import { DoorEventBus, listeningAs } from './door/event-bus'
import { META_TOOL_ICONS, serverIcons } from './icons'
import { META_OUTPUT_SCHEMAS } from './meta-output-schemas'
import { configuredAppOrigin } from '@/lib/app-origin'
import { PRODUCT_NAME } from '@/lib/brand'
import { ASK_CREATE, TASKS_EXTENSION, offersAskTasks, registerAskTasks, runAskCreate } from './ask-calls'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { UI_EXTENSION, VIEW_TOOL_NOTE, appHostOf, offersAppViews, registerAppViews, viewMetaOf } from './mcp-apps'
import type { McpCallContext, McpMode } from './telemetry'

import { IDEMPOTENCY_KEY_DESCRIPTION } from './door-idempotency'
import { ONBOARDING_GUIDE_URI, offersOnboardingGuide, registerOnboardingGuide } from './door/platform-guide'

export const MODE_HEADER = 'x-piloti-mcp-mode'

export const MCP_INSTRUCTIONS = [
  `${PRODUCT_NAME} is the workspace for architects: a planning office runs its projects and processes in it, and ${PRODUCT_NAME}, the agent, is a colleague in that office.`,
  'Through this server you act for the signed-in person, with exactly the rights they have: their projects, documents, folders, review, conversations, tasks, skills and knowledge.',
  'Read the resource piloti://guide once: how the workspace fits together and how ids flow; piloti://catalog lists every operation you may run, piloti://glossary the office\'s German words.',
  'Start with project-list to see which projects exist, then search-operations to find what you need and call-operation to run it (describe-operation shows an input you do not know).',
  'Ask the person before a destructive operation. If nothing fits what they asked for, say so and call report-missing-operation.',
  IDEMPOTENCY_KEY_DESCRIPTION,
].join(' ')

export const PLATFORM_MCP_INSTRUCTIONS = [
  `This is the ${PRODUCT_NAME} platform console: the platform operator runs ${PRODUCT_NAME} for every planning office here, and you act for a platform operator with exactly the platform permissions they hold.`,
  'Settings, prices, models and the base knowledge corpus here apply to every organization at once; nothing of an office\'s own workspace is here.',
  'Nor is anything an office wrote (conversations, feedback, ratings, lessons): platform staff read that in the platform console in the browser, never through an agent.',
  'Start with platform-overview-get for the organizations, then search-operations to find what you need and call-operation to run it (describe-operation shows an input you do not know).',
  'Ask the person before every destructive operation: here one reaches every tenant. If nothing fits, say so and call report-missing-operation.',
  `To onboard a country's knowledge, read the resource ${ONBOARDING_GUIDE_URI} first.`,
  IDEMPOTENCY_KEY_DESCRIPTION,
  'A refusal carries an RFC 9457 problem in structuredContent.problem; branch on its code.',
].join(' ')

const SERVER_IDENTITY: Readonly<Record<AgentDoor, { name: string; title: string; instructions: string }>> = {
  office: { name: 'workspace', title: PRODUCT_NAME, instructions: MCP_INSTRUCTIONS },
  platform: { name: 'workspace-platform', title: `${PRODUCT_NAME} platform`, instructions: PLATFORM_MCP_INSTRUCTIONS },
}

const ALWAYS_LOAD: ReadonlySet<string> = new Set(['project-list', 'knowledge-search', 'files-list'])
const ALWAYS_LOAD_META = { 'anthropic/alwaysLoad': true } as const

export function resolveMode(request: Request): McpMode {
  const asked = request.headers.get(MODE_HEADER) ?? new URL(request.url).searchParams.get('mode')
  return asked?.toLowerCase() === 'tools' ? 'tools' : 'search'
}

type JsonSchemaInput = Parameters<typeof fromJsonSchema>[0]

const operationSchemas = new Map<string, StandardSchemaWithJSON>()

function operationSchema(op: AgentOperation): StandardSchemaWithJSON {
  let schema = operationSchemas.get(op.name)
  if (!schema) {
    schema = fromJsonSchema(inputSchemaOf(op) as JsonSchemaInput)
    operationSchemas.set(op.name, schema)
  }
  return schema
}

const backendSchemas = new Map<string, StandardSchemaWithJSON>()

function backendSchema(op: BackendOperation): StandardSchemaWithJSON {
  let schema = backendSchemas.get(op.name)
  if (!schema) {
    schema = fromJsonSchema(op.inputSchema as JsonSchemaInput)
    backendSchemas.set(op.name, schema)
  }
  return schema
}

export function listedAnnotations(annotations: ToolAnnotations): ToolAnnotations {
  const { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } = annotations
  if (readOnlyHint) return { readOnlyHint: true, openWorldHint: openWorldHint ?? true }
  return {
    destructiveHint: destructiveHint ?? true,
    ...(idempotentHint ? { idempotentHint: true } : {}),
    openWorldHint: openWorldHint ?? true,
  }
}

function outputSchemaOf(name: string): { outputSchema?: StandardSchemaWithJSON } {
  const schema = (META_OUTPUT_SCHEMAS as Readonly<Record<string, unknown>>)[name]
  return schema ? { outputSchema: fromJsonSchema(schema as JsonSchemaInput) } : {}
}

type ToolAnswer = CallToolResult | InputRequiredResult | Promise<CallToolResult | InputRequiredResult>

function callOperationFor(ctx: McpCallContext, args: unknown, req: ServerContext, era: McpEra): ToolAnswer {
  const asks = era === 'modern' && typeof args === 'object' && args !== null && (args as { name?: unknown }).name === ASK_CREATE
  const input = asks ? (args as { input?: unknown }).input : undefined
  if (asks && (input === undefined || (typeof input === 'object' && input !== null && !Array.isArray(input)))) {
    return runAskCreate(ctx, (input ?? {}) as OperationInput, req)
  }
  return confirmThenRun(ctx, req, catalogCallOf(ctx.principal, args), (runCtx) => callOperationTool(runCtx, args))
}

function registerMetaTools(server: McpServer, ctx: McpCallContext, era: McpEra): void {
  const handlers: Record<MetaToolName, (args: unknown, req: ServerContext) => ToolAnswer> = {
    'search-operations': (args) => searchOperations(ctx, args),
    'describe-operation': (args) => describeOperation(ctx, args),
    'call-operation': (args, req) => callOperationFor(ctx, args, req, era),
    'report-missing-operation': (args) => reportMissingOperation(ctx, args),
  }
  for (const [name, tool] of Object.entries(metaToolsFor(ctx.principal)) as [MetaToolName, ReturnType<typeof metaToolsFor>[MetaToolName]][]) {
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaInput),
        ...outputSchemaOf(name),
        icons: META_TOOL_ICONS[name],
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: name === 'call-operation',
          idempotentHint: tool.readOnly,
          openWorldHint: false,
        },
        _meta: ALWAYS_LOAD_META,
      },
      (args: unknown, req: ServerContext) => handlers[name](args, req),
    )
  }
}

function registerOperationTool(server: McpServer, ctx: McpCallContext, era: McpEra, op: AgentOperation): void {
  const view = viewMetaOf(ctx, op.name)
  const meta = { ...(ALWAYS_LOAD.has(op.name) ? ALWAYS_LOAD_META : {}), ...(view ?? {}) }
  const config = {
    title: op.summary,
    description: view ? op.description + VIEW_TOOL_NOTE : op.description,
    inputSchema: operationSchema(op),
    annotations: listedAnnotations(annotationsOf(op)),
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  }
  const handler =
    op.name === ASK_CREATE && era === 'modern'
      ? (args: unknown, req: ServerContext) => runAskCreate(ctx, (args ?? {}) as OperationInput, req)
      : (args: unknown, req: ServerContext) => {
          const input = (args ?? {}) as OperationInput
          return confirmThenRun(ctx, req, { operation: op.name, input }, (runCtx) => runOperation(runCtx, op.name, input))
        }
  if (view) registerAppTool(server, op.name, { ...config, _meta: meta }, handler)
  else server.registerTool(op.name, config, handler)
}

function registerOperationTools(server: McpServer, ctx: McpCallContext, era: McpEra): void {
  for (const op of visibleOperations(ctx.principal)) registerOperationTool(server, ctx, era, op)
  for (const op of visibleBackendOperations(ctx.principal)) {
    server.registerTool(
      op.name,
      {
        title: op.summary,
        description: op.description,
        inputSchema: backendSchema(op),
        annotations: listedAnnotations(op.annotations),
        ...(ALWAYS_LOAD.has(op.name) ? { _meta: ALWAYS_LOAD_META } : {}),
      },
      (args: unknown) => runBackendOperation(ctx, op, (args ?? {}) as Record<string, unknown>),
    )
  }
  const missing = metaToolsFor(ctx.principal)['report-missing-operation']
  server.registerTool(
    'report-missing-operation',
    {
      title: missing.title,
      description: missing.description,
      inputSchema: fromJsonSchema(missing.inputSchema as JsonSchemaInput),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args: unknown) => reportMissingOperation(ctx, args),
  )
}

export type McpEra = 'modern' | 'legacy'

function capabilitiesFor(ctx: McpCallContext, era: McpEra) {
  const live = era === 'modern' && offersProjectResource(ctx)
  const tasks = era === 'modern' && offersAskTasks(ctx.principal)
  const apps = era === 'modern' && offersAppViews(ctx)
  const extensions = { ...(tasks ? { [TASKS_EXTENSION]: {} } : {}), ...(apps ? { [UI_EXTENSION]: {} } : {}) }
  return {
    tools: { listChanged: false },
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
    ...(offersDoorGuide(ctx)
      ? { prompts: { listChanged: false }, resources: live ? { listChanged: true, subscribe: true } : { listChanged: false } }
      : {}),
    ...(offersOnboardingGuide(ctx) ? { resources: { listChanged: false } } : {}),
  }
}

export function buildMcpServer(
  principal: AgentPrincipal,
  mode: McpMode,
  era: McpEra = 'legacy',
  clientCapabilities?: unknown,
): McpServer {
  const { name, title, instructions } = SERVER_IDENTITY[doorOfPrincipal(principal)]
  const confirmation = era === 'modern' ? confirmationFor(principal) : null
  const appHost = appHostOf(era, clientCapabilities)
  const ctx: McpCallContext = {
    principal,
    mode,
    ...(confirmation ? { confirmation } : {}),
    ...(appHost ? { appHost } : {}),
  }
  const websiteUrl = configuredAppOrigin()
  const capabilities = capabilitiesFor(ctx, era)
  const server = new McpServer(
    { name, title, version: '1.0.0', icons: serverIcons(websiteUrl), ...(websiteUrl ? { websiteUrl } : {}) },
    confirmation ? { instructions, capabilities, requestState: { verify: confirmation.codec.verify } } : { instructions, capabilities },
  )
  if (mode === 'tools') registerOperationTools(server, ctx, era)
  else registerMetaTools(server, ctx, era)
  registerDoorGuide(server, ctx)
  registerOnboardingGuide(server, ctx)
  registerAppViews(server, ctx, (op) => {
    if (findVisibleOperation(principal, op.name)) registerOperationTool(server, ctx, era, op)
  })
  if (era === 'modern' && offersAskTasks(principal)) registerAskTasks(server, ctx)
  return server
}

export interface AgentDoorRequest {
  principal: AgentPrincipal
  mode: McpMode
  clientCapabilities?: unknown
}

async function clientCapabilitiesOf(request: Request): Promise<unknown> {
  try {
    const body = (await request.clone().json()) as { params?: { _meta?: Record<string, unknown> } }
    return body?.params?._meta?.[CLIENT_CAPABILITIES_META_KEY]
  } catch {
    return undefined
  }
}

const BOTH_ACCEPT_TYPES = 'application/json, text/event-stream'

function acceptingJson(request: Request): Request {
  const accept = request.headers.get('accept')
  const takesJson = !accept || /application\/json|application\/\*|\*\/\*/.test(accept)
  if (!takesJson || (accept?.includes('application/json') && accept.includes('text/event-stream'))) return request
  const headers = new Headers(request.headers)
  headers.set('accept', BOTH_ACCEPT_TYPES)
  return new Request(request, { headers })
}

async function serveLegacyAsJson(request: Request, authInfo: AuthInfo | undefined, onerror: (error: Error) => void): Promise<Response> {
  const { principal, mode } = authInfo?.extra as unknown as AgentDoorRequest
  const server = buildMcpServer(principal, mode, 'legacy')
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  transport.onerror = onerror
  await server.connect(transport)
  try {
    return await transport.handleRequest(acceptingJson(request), authInfo ? { authInfo } : undefined)
  } finally {
    await transport.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

export function createAgentDoorHandler(
  onerror: (error: Error) => void = (error) => console.error('[mcp]', error.message),
  bus: ServerEventBus = new DoorEventBus(),
) {
  const modern = createMcpHandler(
    (context) => {
      const { principal, mode, clientCapabilities } = context.authInfo?.extra as unknown as AgentDoorRequest
      return buildMcpServer(principal, mode, 'modern', clientCapabilities)
    },
    { legacy: 'reject', responseMode: 'auto', onerror, bus },
  )
  return {
    bus: modern.bus,
    async fetch(request: Request, options: { authInfo?: AuthInfo } = {}): Promise<Response> {
      if (request.method.toUpperCase() !== 'POST') return modern.fetch(request, options)
      if (await isLegacyRequest(request)) return serveLegacyAsJson(request, options.authInfo, onerror)
      if (request.headers.get('mcp-method') === 'subscriptions/listen' && options.authInfo) {
        return serveListen((r, o) => modern.fetch(r, o), request, options.authInfo)
      }
      if (!options.authInfo) return modern.fetch(request, options)
      const clientCapabilities = await clientCapabilitiesOf(request)
      const extra = { ...options.authInfo.extra, clientCapabilities }
      return modern.fetch(request, { ...options, authInfo: { ...options.authInfo, extra } })
    },
  }
}

interface ListenBody {
  params?: { notifications?: { resourceSubscriptions?: unknown } }
}

async function serveListen(handle: (request: Request, options: { authInfo?: AuthInfo }) => Promise<Response>, request: Request, authInfo: AuthInfo): Promise<Response> {
  const { principal, mode } = authInfo.extra as unknown as AgentDoorRequest
  let body: ListenBody | null = null
  try {
    body = (await request.clone().json()) as ListenBody
  } catch {
    body = null
  }
  const asked = body?.params?.notifications?.resourceSubscriptions
  let forwarded = request
  if (body && Array.isArray(asked)) {
    const allowed = await readableProjectUris({ principal, mode }, asked.filter((uri): uri is string => typeof uri === 'string'))
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    const narrowed = { ...body, params: { ...body.params, notifications: { ...body.params?.notifications, resourceSubscriptions: allowed } } }
    forwarded = new Request(request.url, { method: 'POST', headers, body: JSON.stringify(narrowed), signal: request.signal })
  }
  return listeningAs(principal.session.organizationId, () => handle(forwarded, { authInfo }))
}
