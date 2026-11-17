import { type Artifact, type Message, type Part, Role, type Task, TaskState } from '@a2a-js/sdk'
import {
  ContentTypeNotSupportedError,
  RequestMalformedError,
  UnsupportedOperationError,
} from '@a2a-js/sdk/errors'
import type { AskDocument, AskState, AskView, CreateAskRequest } from '@/lib/agent-asks/ask-wire'
import { conversationIdSchema } from '@/lib/session-documents/conversation-id'
import { PRODUCT_NAME } from '@/lib/brand'
import { AI_GENERATED_META } from '@/lib/agent-api/ai-generated-meta'

export const TASK_STATE_OF: Readonly<Record<AskState, TaskState>> = {
  submitted: TaskState.TASK_STATE_SUBMITTED,
  working: TaskState.TASK_STATE_WORKING,
  completed: TaskState.TASK_STATE_COMPLETED,
  canceled: TaskState.TASK_STATE_CANCELED,
  failed: TaskState.TASK_STATE_FAILED,
  rejected: TaskState.TASK_STATE_REJECTED,
}

export const ANSWER_ARTIFACT_NAME = 'answer'

const textPart = (text: string): Part => ({
  content: { $case: 'text', value: text },
  metadata: undefined,
  filename: '',
  mediaType: 'text/plain',
})

function message(view: AskView, role: Role, messageId: string, text: string): Message {
  return {
    messageId,
    contextId: view.conversationId,
    taskId: view.id,
    role,
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  }
}

function documentArtifact(document: AskDocument): Artifact {
  return {
    artifactId: document.versionId,
    name: document.name,
    description: 'A document ' + PRODUCT_NAME + ' filed while answering. Read it with the agent door (document-get, document-download).',
    parts: [
      {
        content: {
          $case: 'data',
          value: { documentId: document.documentId, versionId: document.versionId, projectId: document.projectId },
        },
        metadata: undefined,
        filename: document.name,
        mediaType: 'application/json',
      },
    ],
    metadata: document.contentType ? { contentType: document.contentType } : undefined,
    extensions: [],
  }
}

function evidenceParts(answer: NonNullable<AskView['answer']>): Part[] {
  const { sources, confidence } = answer
  if (!sources && !confidence) return []
  return [
    {
      content: { $case: 'data', value: { ...(sources && { sources }), ...(confidence && { confidence }) } },
      metadata: undefined,
      filename: '',
      mediaType: 'application/json',
    },
  ]
}

export function artifactsOf(view: AskView): Artifact[] {
  const answer: Artifact[] = view.answer
    ? [
        {
          artifactId: view.answer.messageId,
          name: ANSWER_ARTIFACT_NAME,
          description: PRODUCT_NAME + '’s answer.',
          parts: [textPart(view.answer.text), ...evidenceParts(view.answer)],
          metadata: { ...AI_GENERATED_META },
          extensions: [],
        },
      ]
    : []
  return [...answer, ...view.documents.map(documentArtifact)]
}

export function taskOf(view: AskView, historyLength?: number): Task {
  const history: Message[] = []
  if (view.question !== null) history.push(message(view, Role.ROLE_USER, view.id, view.question))
  if (view.answer) history.push(message(view, Role.ROLE_AGENT, view.answer.messageId, view.answer.text))
  const why = view.reason ? message(view, Role.ROLE_AGENT, `${view.id}:status`, view.reason) : undefined
  return {
    id: view.id,
    contextId: view.conversationId,
    status: { state: TASK_STATE_OF[view.state], message: why, timestamp: view.updatedAt },
    artifacts: artifactsOf(view),
    history: historyLength === undefined ? history : history.slice(Math.max(0, history.length - historyLength)),
    metadata: { projectId: view.projectId, pollAfterSeconds: view.pollAfterSeconds },
  }
}

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export function askInputOf(incoming: Message | undefined, metadata?: Record<string, unknown>): CreateAskRequest {
  if (!incoming) throw new RequestMalformedError('The request carries no message.')
  if (incoming.role === Role.ROLE_AGENT) throw new RequestMalformedError('Send the question as role user.')
  if (incoming.taskId) {
    throw new UnsupportedOperationError(
      PRODUCT_NAME + ' never waits for input on a task. Send a new message with the same contextId to follow up.',
    )
  }
  const texts: string[] = []
  for (const part of incoming.parts) {
    if (part.content?.$case !== 'text') {
      throw new ContentTypeNotSupportedError(
        PRODUCT_NAME + ' reads text. Put files into the workspace with the agent door and name them in the question.',
      )
    }
    texts.push(part.content.value)
  }
  const question = texts.join('\n\n').trim()
  if (!question) throw new RequestMalformedError('The message has no text.')
  const projectId = incoming.metadata?.projectId ?? metadata?.projectId
  return {
    question,
    ...(isString(projectId) ? { projectId } : {}),
    ...(incoming.contextId && conversationIdSchema.safeParse(incoming.contextId).success
      ? { conversationId: incoming.contextId }
      : {}),
  }
}
