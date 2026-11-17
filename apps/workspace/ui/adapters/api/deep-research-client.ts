import { apiConfig } from './config'
import { ApiRequestError } from './api-error'
import type { WireCitationSource } from '@/features/chat/types'

export type DeepResearchJobStatus = 'submitted' | 'running' | 'success' | 'failure' | 'interrupted'

const VALID_JOB_STATUSES: ReadonlySet<DeepResearchJobStatus> = new Set([
  'submitted',
  'running',
  'success',
  'failure',
  'interrupted',
])

export type DeepResearchEventType =
  | 'stream.start'
  | 'stream.mode'
  | 'job.status'
  | 'job.heartbeat'
  | 'job.phase'
  | 'workflow.start'
  | 'workflow.end'
  | 'llm.start'
  | 'llm.chunk'
  | 'llm.end'
  | 'tool.start'
  | 'tool.end'
  | 'artifact.update'
  | 'run.ledger'

export type ArtifactType = 'todo' | 'citation_source' | 'citation_use' | 'file' | 'output'

export interface DeepResearchSSEEvent {
  event: DeepResearchEventType
  id?: string
  timestamp?: string
}

export interface StreamStartEvent extends DeepResearchSSEEvent {
  event: 'stream.start'
  job_id: string
}

export interface JobStatusEvent extends DeepResearchSSEEvent {
  event: 'job.status'
  data: {
    status: DeepResearchJobStatus
    error?: string
  }
}

export interface WorkflowStartEvent extends DeepResearchSSEEvent {
  event: 'workflow.start'
  data: {
    name: string
    data?: {
      input?: string
    }
  }
}

export interface WorkflowEndEvent extends DeepResearchSSEEvent {
  event: 'workflow.end'
  data: {
    name: string
    data?: {
      output?: string
    }
  }
}

export interface LLMStartEvent extends DeepResearchSSEEvent {
  event: 'llm.start'
  data: {
    name: string
    metadata?: {
      workflow?: string
    }
  }
}

export interface LLMChunkEvent extends DeepResearchSSEEvent {
  event: 'llm.chunk'
  data: {
    chunk: string
  }
}

export interface LLMEndEvent extends DeepResearchSSEEvent {
  event: 'llm.end'
  data: {
    output: string
    metadata?: {
      thinking?: string
      usage?: {
        prompt_tokens: number
        completion_tokens: number
      }
    }
  }
}

export interface ToolStartEvent extends DeepResearchSSEEvent {
  event: 'tool.start'
  data: {
    name: string
    data?: {
      input?: Record<string, unknown>
    }
    metadata?: {
      workflow?: string
      agent_id?: string
    }
  }
}

export interface ToolEndEvent extends DeepResearchSSEEvent {
  event: 'tool.end'
  data: {
    name: string
    data?: {
      output?: string
    }
  }
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface ArtifactUpdateEvent extends DeepResearchSSEEvent {
  event: 'artifact.update'
  data: {
    id: string
    timestamp: string
    data: {
      type: ArtifactType
      content: string | TodoItem[]
      url?: string // For citation_source and citation_use types
      output_category?: string // For output type (e.g. "final_report")
      cards?: unknown[] // Grid response cards attached to the final report output
      title?: string
      citation_key?: string
      collection?: string
      source_type?: string
      tool?: string
      origin?: string
      file_name?: string
      page?: number
      kind?: string
      lane?: string
      lane_label?: string
      binding_note?: string
      number?: number
    }
    metadata?: {
      workflow?: string
    }
  }
}

export type DeepResearchEvent =
  | StreamStartEvent
  | JobStatusEvent
  | WorkflowStartEvent
  | WorkflowEndEvent
  | LLMStartEvent
  | LLMChunkEvent
  | LLMEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | ArtifactUpdateEvent

export interface DeepResearchCallbacks {
  onStreamStart?: (jobId: string) => void
  onStreamMode?: (mode: string) => void
  onJobStatus?: (status: DeepResearchJobStatus, error?: string) => void
  onWorkflowStart?: (name: string, input?: string, eventId?: string, agentId?: string) => void
  onWorkflowEnd?: (name: string, output?: string, eventId?: string, agentId?: string) => void
  onLLMStart?: (name: string, workflow?: string) => void
  onLLMChunk?: (chunk: string) => void
  onLLMEnd?: (
    output: string,
    thinking?: string,
    usage?: { input_tokens: number; output_tokens: number }
  ) => void
  onToolStart?: (name: string, input?: Record<string, unknown>, workflow?: string, eventId?: string, agentId?: string) => void
  onToolEnd?: (name: string, output?: string, eventId?: string, agentId?: string) => void
  onTodoUpdate?: (todos: TodoItem[], workflow?: string) => void
  onCitationUpdate?: (wire: WireCitationSource, isCited: boolean) => void
  onFileUpdate?: (filename: string, content: string) => void
  onOutputUpdate?: (
    content: string,
    outputCategory?: string,
    workflow?: string,
    cards?: unknown[]
  ) => void
  onHeartbeat?: (uptimeSeconds: number) => void
  onPhase?: (phase: string, data?: Record<string, unknown>) => void
  onLedger?: (ledger: unknown) => void
  onComplete?: () => void
  onError?: (error: Error) => void
  onDisconnect?: () => void
  onReconnecting?: (attempt: number) => void
}

const normalizeToolInput = (input: unknown): Record<string, unknown> | undefined => {
  if (input == null) return undefined

  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Not valid JSON — likely a Python repr string from str(dict)
    }

    return { _raw: input, _truncated: true }
  }

  return { _raw: String(input) }
}

export interface DeepResearchStreamOptions {
  jobId: string
  callbacks: DeepResearchCallbacks
  lastEventId?: string
  authToken?: string
  projectId?: string | null
  conversationId?: string | null
}

export interface DeepResearchClient {
  connect: () => void
  disconnect: () => void
  isConnected: () => boolean
  getLastEventId: () => string | null
}

const MAX_RECONNECT_ATTEMPTS = 5

const STREAM_REOPEN_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000]
const STREAM_REOPEN_GIVE_UP_MS = 120_000
const STREAM_REOPEN_AFTER_SHUTDOWN_MS = 250

export const createDeepResearchClient = (options: DeepResearchStreamOptions): DeepResearchClient => {
  const { jobId, callbacks, lastEventId, authToken, projectId, conversationId } = options

  let eventSource: EventSource | null = null
  let lastReceivedEventId: string | null = lastEventId || null
  let isTerminated = false
  let reconnectAttempts = 0
  let reopenTimer: ReturnType<typeof setTimeout> | null = null
  let reopenAttempts = 0
  let failingSince: number | null = null

  const buildStreamUrl = (): string => {
    const isBrowser = typeof window !== 'undefined'
    const baseUrl = isBrowser ? '' : apiConfig.baseUrl

    let url = `${baseUrl}/api/jobs/async/job/${jobId}/stream`

    if (lastReceivedEventId) {
      url += `/${lastReceivedEventId}`
    }

    const query = new URLSearchParams()
    if (authToken) query.set('token', authToken)
    if (projectId) query.set('projectId', projectId)
    if (conversationId) query.set('conversationId', conversationId)
    const search = query.toString()

    return search ? `${url}?${search}` : url
  }

  const parseEventData = (data: string): unknown => {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }

  const handleMessage = (event: MessageEvent, eventType: string) => {
    if (event.lastEventId) {
      lastReceivedEventId = event.lastEventId
    }

    const rawData = parseEventData(event.data)

    switch (eventType) {
      case 'stream.start': {
        const streamData = rawData as { job_id: string }
        callbacks.onStreamStart?.(streamData.job_id || jobId)
        break
      }

      case 'stream.mode': {
        const modeData = rawData as { mode?: string }
        if (modeData.mode) {
          callbacks.onStreamMode?.(modeData.mode)
        }
        break
      }

      case 'job.heartbeat': {
        const heartbeatData = rawData as { data?: { uptime_seconds?: number }; uptime_seconds?: number }
        const uptimeSeconds = heartbeatData.data?.uptime_seconds ?? heartbeatData.uptime_seconds ?? 0
        callbacks.onHeartbeat?.(uptimeSeconds)
        break
      }

      case 'job.phase': {
        const phaseWrapper = rawData as { data?: { phase?: string } & Record<string, unknown>; phase?: string }
        const phaseData = phaseWrapper.data || phaseWrapper
        const phase = phaseData.phase
        if (typeof phase === 'string' && phase.length > 0) {
          callbacks.onPhase?.(phase, phaseData as Record<string, unknown>)
        } else if (process.env.NODE_ENV === 'development') {
          console.warn('[SSE:job.phase] Ignoring event without a phase string')
        }
        break
      }

      case 'job.status': {
        const statusWrapper = rawData as { data?: { status?: DeepResearchJobStatus; error?: string }; status?: DeepResearchJobStatus; error?: string }
        const statusData = statusWrapper.data || statusWrapper
        const status = statusData.status
        if (!status || !VALID_JOB_STATUSES.has(status)) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[SSE:job.status] Ignoring event with invalid status:', status)
          }
          break
        }
        callbacks.onJobStatus?.(status, statusData.error)

        if (status === 'success') {
          isTerminated = true
          eventSource?.close()
          callbacks.onComplete?.()
        } else if (status === 'failure' || status === 'interrupted') {
          isTerminated = true
          eventSource?.close()
          const isUserCancelled = status === 'interrupted' && statusData.error?.toLowerCase().includes('cancelled by user')
          if (!isUserCancelled) {
            callbacks.onError?.(new Error(statusData.error || `Job ${status}`))
          }
        }
        break
      }

      case 'workflow.start': {
        const workflowData = rawData as { id?: string; name: string; data?: { input?: string }; metadata?: { agent_id?: string } }
        callbacks.onWorkflowStart?.(workflowData.name, workflowData.data?.input, workflowData.id, workflowData.metadata?.agent_id)
        break
      }

      case 'workflow.end': {
        const workflowData = rawData as { id?: string; name: string; data?: { output?: string }; metadata?: { agent_id?: string } }
        callbacks.onWorkflowEnd?.(workflowData.name, workflowData.data?.output, workflowData.id, workflowData.metadata?.agent_id)
        break
      }

      case 'llm.start': {
        const llmData = rawData as { name: string; metadata?: { workflow?: string } }
        callbacks.onLLMStart?.(llmData.name, llmData.metadata?.workflow)
        break
      }

      case 'llm.chunk': {
        const chunkData = rawData as { chunk?: string; data?: { chunk?: string } }
        const chunk = chunkData.chunk || chunkData.data?.chunk || ''
        callbacks.onLLMChunk?.(chunk)
        break
      }

      case 'llm.end': {
        const endData = rawData as {
          data?: { output?: string }
          metadata?: {
            thinking?: string
            usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
          }
        }
        const output = endData.data?.output || ''
        const thinking = endData.metadata?.thinking
        const rawUsage = endData.metadata?.usage
        const usage = rawUsage
          ? {
              input_tokens: rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? 0,
              output_tokens: rawUsage.output_tokens ?? rawUsage.completion_tokens ?? 0,
            }
          : undefined
        callbacks.onLLMEnd?.(output, thinking, usage)
        break
      }

      case 'tool.start': {
        const toolData = rawData as {
          id?: string
          name: string
          data?: { input?: unknown }
          metadata?: { workflow?: string; agent_id?: string }
        }
        const normalizedInput = normalizeToolInput(toolData.data?.input)
        callbacks.onToolStart?.(toolData.name, normalizedInput, toolData.metadata?.workflow, toolData.id, toolData.metadata?.agent_id)
        break
      }

      case 'tool.end': {
        const toolData = rawData as { id?: string; name: string; data?: { output?: string }; metadata?: { agent_id?: string } }
        callbacks.onToolEnd?.(toolData.name, toolData.data?.output, toolData.id, toolData.metadata?.agent_id)
        break
      }

      case 'artifact.update': {
        const artifactWrapper = rawData as {
          data?: { type: ArtifactType; content: string | TodoItem[]; url?: string; output_category?: string; cards?: unknown[] }
          type?: ArtifactType
          content?: string | TodoItem[]
          url?: string
          output_category?: string
          cards?: unknown[]
          metadata?: { workflow?: string }
        }
        const artifactData = artifactWrapper.data || artifactWrapper
        const artifactWorkflow = artifactWrapper.metadata?.workflow

        switch (artifactData.type) {
          case 'todo':
            callbacks.onTodoUpdate?.(artifactData.content as TodoItem[], artifactWorkflow)
            break
          case 'citation_source':
          case 'citation_use': {
            const isCited = artifactData.type === 'citation_use'
            callbacks.onCitationUpdate?.(artifactData as WireCitationSource, isCited)
            break
          }
          case 'file': {
            const raw = artifactData as Record<string, unknown>
            const filePath = (raw.file_path || raw.path || artifactData.url || 'unknown') as string
            const fileName = filePath.split('/').pop() || filePath
            callbacks.onFileUpdate?.(fileName, artifactData.content as string)
            break
          }
          case 'output':
            callbacks.onOutputUpdate?.(
              artifactData.content as string,
              artifactData.output_category,
              artifactWorkflow,
              artifactData.cards
            )
            break
          default:
            if (process.env.NODE_ENV === 'development') {
              console.warn('[SSE:artifact.update] Unknown artifact type:', artifactData.type)
            }
        }
        break
      }

      case 'run.ledger': {
        const ledgerWrapper = rawData as { data?: { ledger?: unknown }; ledger?: unknown }
        const ledger = ledgerWrapper.data?.ledger ?? ledgerWrapper.ledger
        if (ledger !== undefined) {
          callbacks.onLedger?.(ledger)
        } else if (process.env.NODE_ENV === 'development') {
          console.warn('[SSE:run.ledger] Ignoring event without a ledger')
        }
        break
      }

      default:
        if (process.env.NODE_ENV === 'development') {
          console.warn('[SSE] Unknown event type:', eventType, rawData)
        }
        break
    }
  }

  const connect = () => {
    if (eventSource) {
      return // Already connected
    }

    isTerminated = false
    const url = buildStreamUrl()
    eventSource = new EventSource(url)

    eventSource.onopen = () => {
      reconnectAttempts = 0
      reopenAttempts = 0
      failingSince = null
    }

    eventSource.addEventListener('job.shutdown', () => {
      eventSource?.close()
      eventSource = null
      scheduleReopen(STREAM_REOPEN_AFTER_SHUTDOWN_MS)
    })

    eventSource.onmessage = (event) => {
      handleMessage(event, 'message')
    }

    const eventTypes: DeepResearchEventType[] = [
      'stream.start',
      'stream.mode',
      'job.status',
      'job.heartbeat',
      'workflow.start',
      'workflow.end',
      'llm.start',
      'llm.chunk',
      'llm.end',
      'tool.start',
      'tool.end',
      'artifact.update',
      'job.phase',
      'run.ledger',
    ]

    eventTypes.forEach((eventType) => {
      eventSource?.addEventListener(eventType, (event) => {
        handleMessage(event as MessageEvent, eventType)
      })
    })

    eventSource.onerror = () => {
      if (isTerminated) {
        eventSource?.close()
        eventSource = null
        return
      }

      if (eventSource?.readyState === EventSource.CLOSED) {
        eventSource = null
        scheduleReopen()
      } else if (eventSource?.readyState === EventSource.CONNECTING) {
        reconnectAttempts++
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          callbacks.onReconnecting?.(reconnectAttempts)
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[SSE] Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`)
          }
          return // let EventSource retry on its own
        }
        eventSource?.close()
        eventSource = null
        callbacks.onError?.(
          new Error(`SSE connection failed after ${reconnectAttempts} reconnection attempts`)
        )
      } else {
        const readyState = eventSource?.readyState
        eventSource?.close()
        eventSource = null
        callbacks.onError?.(
          new Error(`SSE connection error in unexpected readyState: ${readyState ?? 'unknown'}`)
        )
      }
    }
  }

  function scheduleReopen(delayMs?: number) {
    if (isTerminated || reopenTimer) return
    const now = Date.now()
    failingSince ??= now
    if (now - failingSince >= STREAM_REOPEN_GIVE_UP_MS) {
      callbacks.onDisconnect?.()
      return
    }
    const wait = delayMs ?? STREAM_REOPEN_DELAYS_MS[Math.min(reopenAttempts, STREAM_REOPEN_DELAYS_MS.length - 1)]
    reopenAttempts++
    callbacks.onReconnecting?.(reopenAttempts)
    reopenTimer = setTimeout(() => {
      reopenTimer = null
      if (!isTerminated) connect()
    }, wait)
  }

  const disconnect = () => {
    if (reopenTimer) {
      clearTimeout(reopenTimer)
      reopenTimer = null
    }
    isTerminated = true
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  const isConnected = (): boolean => {
    return eventSource !== null && eventSource.readyState === EventSource.OPEN
  }

  const getLastEventId = (): string | null => {
    return lastReceivedEventId
  }

  return {
    connect,
    disconnect,
    isConnected,
    getLastEventId,
  }
}

const getDeepResearchBaseUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '/api/jobs/async' : `${apiConfig.baseUrl}/v1/jobs/async`
}

const getDeepResearchErrorDetails = async (response: Response): Promise<string | null> => {
  const responseText = await response.text().catch(() => '')
  if (!responseText) return null

  try {
    const parsed = JSON.parse(responseText) as {
      error?: {
        code?: unknown
        message?: unknown
      }
    }
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    return [code, message].filter(Boolean).join(': ') || responseText
  } catch {
    return responseText
  }
}

const throwDeepResearchApiError = async (response: Response, context: string): Promise<never> => {
  const details = await getDeepResearchErrorDetails(response)
  throw new ApiRequestError(
    `${context}: ${response.status}${details ? ` - ${details}` : ''}`,
    response.status
  )
}

export const getJobStatus = async (
  jobId: string,
  authToken?: string
): Promise<{
  job_id: string
  status: DeepResearchJobStatus
  error: string | null
  created_at?: string | null
}> => {
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to get job status')
  }

  return response.json()
}

export interface JobReportFiling {
  documentId: string
  filename: string
  alreadyFiled: boolean
}

export interface JobReportResponse {
  job_id: string
  has_report: boolean
  report: string | null
  filed?: JobReportFiling
  filingFailed?: boolean
  filingQueued?: boolean
  sources?: WireCitationSource[]
}

function readReportFiling(body: unknown): JobReportFiling | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const filed = (body as { filed?: unknown }).filed
  if (typeof filed !== 'object' || filed === null) return undefined
  const { documentId, filename, alreadyFiled } = filed as Record<string, unknown>
  if (typeof documentId !== 'string' || !documentId) return undefined
  if (typeof filename !== 'string' || !filename) return undefined
  return { documentId, filename, alreadyFiled: alreadyFiled === true }
}

export const getJobReport = async (
  jobId: string,
  authToken?: string,
  options: { projectId?: string | null } = {}
): Promise<JobReportResponse> => {
  const query = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : ''
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}/report${query}`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to get job report')
  }

  const body = (await response.json()) as JobReportResponse
  const filed = readReportFiling(body)
  return {
    job_id: body.job_id,
    has_report: body.has_report,
    report: body.report,
    ...(filed ? { filed } : {}),
    ...(body.filingFailed === true ? { filingFailed: true as const } : {}),
    ...(body.filingQueued === true ? { filingQueued: true as const } : {}),
    ...(Array.isArray(body.sources) && body.sources.length > 0 ? { sources: body.sources } : {}),
  }
}

export const cancelJob = async (
  jobId: string,
  authToken?: string,
  options: { projectId?: string | null } = {}
): Promise<{ cancelled: boolean }> => {
  const query = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : ''
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}/cancel${query}`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to cancel job')
  }

  return response.json()
}

export interface JobStateResponse {
  job_id: string
  has_state: boolean
  state: Record<string, unknown> | null
  artifacts: {
    tools: Array<{
      name: string
      input?: Record<string, unknown>
      output?: string
      timestamp?: string
    }>
    outputs: Array<{
      type: string
      content: string
      output_category?: string
      cards?: unknown[]
      timestamp?: string
    }>
  } | null
}

export const getJobState = async (
  jobId: string,
  authToken?: string
): Promise<JobStateResponse> => {
  const url = `${getDeepResearchBaseUrl()}/job/${jobId}/state`
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    await throwDeepResearchApiError(response, 'Failed to get job state')
  }

  return response.json()
}
