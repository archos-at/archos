export interface StoredPromptOption {
  id: string
  label: string
}

export interface StoredPromptDetail {
  promptId?: string
  promptParentId?: string
  promptInputType?: 'text' | 'choice'
  promptOptions?: StoredPromptOption[]
  promptPlaceholder?: string
  promptFor?: string
}

export interface StoredPromptState {
  response: string
  respondedAt: string
}

const MAX_PROMPT_OPTIONS = 32
const MAX_OPTION_CHARS = 400
const MAX_PLACEHOLDER_CHARS = 400
const MAX_RESPONSE_CHARS = 4_000
const MAX_ID_CHARS = 128

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined

export function sanitizePromptOptions(input: unknown): StoredPromptOption[] | undefined {
  if (!Array.isArray(input)) return undefined
  const options = input.slice(0, MAX_PROMPT_OPTIONS).flatMap((option): StoredPromptOption[] => {
    if (!isRecord(option)) return []
    const id = cap(option.id, MAX_ID_CHARS)
    const label = cap(option.label, MAX_OPTION_CHARS)
    return id && label ? [{ id, label }] : []
  })
  return options.length > 0 ? options : undefined
}

export function sanitizePromptDetail(input: unknown): StoredPromptDetail | null {
  if (!isRecord(input)) return null
  const out: StoredPromptDetail = {}

  const id = cap(input.promptId, MAX_ID_CHARS)
  if (id) out.promptId = id
  const parentId = cap(input.promptParentId, MAX_ID_CHARS)
  if (parentId) out.promptParentId = parentId
  if (input.promptInputType === 'text' || input.promptInputType === 'choice') {
    out.promptInputType = input.promptInputType
  }
  const placeholder = cap(input.promptPlaceholder, MAX_PLACEHOLDER_CHARS)
  if (placeholder) out.promptPlaceholder = placeholder
  const promptFor = cap(input.promptFor, MAX_ID_CHARS)
  if (promptFor) out.promptFor = promptFor

  const options = sanitizePromptOptions(input.promptOptions)
  if (options) out.promptOptions = options

  return Object.keys(out).length > 0 ? out : null
}

export function sanitizePromptState(input: unknown): StoredPromptState | null {
  if (!isRecord(input)) return null
  const response = cap(input.response, MAX_RESPONSE_CHARS)
  if (response === undefined) return null
  return { response, respondedAt: new Date().toISOString() }
}
