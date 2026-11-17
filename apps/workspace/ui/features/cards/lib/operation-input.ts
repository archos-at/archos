export interface OperationInputRow {
  key: string
  value: string
  long: boolean
  source: 'body' | 'query' | 'params'
  ids?: string
}

export type IdName = (id: string) => string | null | undefined

export const PREVIEW_LENGTH = 160

function show(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function named(value: unknown, nameOf: IdName): unknown {
  if (typeof value === 'string') return nameOf(value) ?? value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.map((item) => nameOf(item) ?? item)
  return value
}

function rowOf(key: string, value: unknown, source: OperationInputRow['source'], nameOf: IdName): OperationInputRow {
  const raw = show(value)
  const text = show(named(value, nameOf))
  const row: OperationInputRow = { key, value: text, long: text.length > PREVIEW_LENGTH || text.includes('\n'), source }
  return text === raw ? row : { ...row, ids: raw }
}

function rowsOf(record: unknown, source: OperationInputRow['source'], nameOf: IdName): OperationInputRow[] {
  if (!isRecord(record)) return []
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => rowOf(key, value, source, nameOf))
}

const unnamed: IdName = () => null

export function operationInputRows(input: Record<string, unknown>, nameOf: IdName = unnamed): OperationInputRow[] {
  const body = input.body
  const bodyRows = isRecord(body)
    ? rowsOf(body, 'body', nameOf)
    : body === undefined || body === null
      ? []
      : [rowOf('body', body, 'body', nameOf)]
  return [...bodyRows, ...rowsOf(input.query, 'query', nameOf), ...rowsOf(input.params, 'params', nameOf)]
}

export function previewOf(row: OperationInputRow): string {
  const flat = row.value.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : `${flat}…`
}

export const NAMED_INPUT_KEYS = [
  'id',
  'name',
  'title',
  'description',
  'scope',
  'memoryScope',
  'projectId',
  'folderId',
  'parentId',
  'documentId',
  'conversationId',
  'messageId',
  'versionId',
  'annotationId',
  'taskId',
  'itemId',
  'skillId',
  'categoryId',
  'resourceType',
  'resourceId',
  'targetFolder',
  'body',
  'note',
  'comment',
  'content',
  'message',
  'question',
  'reason',
  'decision',
  'kind',
  'role',
  'status',
  'enabled',
  'pinned',
  'confidence',
  'locale',
  'fileName',
  'files',
  'names',
  'displayName',
  'email',
  'visibility',
  'permissions',
  'sortOrder',
] as const

export type NamedInputKey = (typeof NAMED_INPUT_KEYS)[number]

export const isNamedInputKey = (key: string): key is NamedInputKey => (NAMED_INPUT_KEYS as readonly string[]).includes(key)

export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (/^id$/i.test(word) ? 'ID' : word.toLowerCase()))
  if (words.length === 0) return key
  const [first, ...rest] = words
  return [first === 'ID' ? first : first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

export const rowKey = (row: OperationInputRow, index: number) => `${index}:${row.key}`
