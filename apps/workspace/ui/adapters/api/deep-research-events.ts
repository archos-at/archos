export type DeepResearchJobStatus = 'submitted' | 'running' | 'success' | 'failure' | 'interrupted'

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
