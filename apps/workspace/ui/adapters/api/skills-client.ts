import { ApiRequestError } from './api-error'

export interface SkillListItem {
  id: string | null
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  origin: 'org' | 'platform-clone' | 'platform'
  enabled: boolean
  clonedFrom: string | null
  categoryId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface SkillCategoryListItem {
  id: string
  name: string
  description: string | null
  slug: string | null
  sortOrder: number
  scope: 'platform' | 'org'
}

export interface SkillSnapshot {
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  origin: 'org' | 'platform-clone' | 'platform'
}

export interface CreateSkillInput {
  name: string
  description: string
  body: string
  metadata?: Record<string, string>
  enabled?: boolean
  clonedFrom?: string
  categoryId?: string | null
}

export type UpdateSkillInput = Omit<Partial<CreateSkillInput>, 'categoryId'> & {
  categoryId?: string | null
}

export class SkillApiError extends ApiRequestError {
  readonly code: string | null
  readonly serverMessage: string | null

  constructor(message: string, status: number, code: string | null, serverMessage: string | null) {
    super(message, status)
    this.name = 'SkillApiError'
    this.code = code
    this.serverMessage = serverMessage
  }
}

const skillsBase = '/api/skills'

const parseErrorEnvelope = async (
  response: Response,
): Promise<{ message: string | null; code: string | null }> => {
  const text = await response.text().catch(() => '')
  if (!text) return { message: null, code: null }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; code?: unknown }
    const message = typeof parsed.error === 'string' ? parsed.error : null
    const code = typeof parsed.code === 'string' ? parsed.code : null
    return { message, code: code ?? null }
  } catch {
    return { message: text, code: null }
  }
}

const throwSkillApiError = async (response: Response, context: string): Promise<never> => {
  const { message, code } = await parseErrorEnvelope(response)
  throw new SkillApiError(
    `${context}: ${response.status}${message ? ` - ${message}` : ''}`,
    response.status,
    code,
    message,
  )
}

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

export const listSkills = async (): Promise<{
  skills: SkillListItem[]
  categories: SkillCategoryListItem[]
}> => {
  const response = await fetch(skillsBase, { headers: jsonHeaders })
  if (!response.ok) await throwSkillApiError(response, 'Failed to list skills')
  const data = (await response.json()) as
    | { skills?: SkillListItem[]; categories?: SkillCategoryListItem[] }
    | SkillListItem[]
  if (Array.isArray(data)) return { skills: data, categories: [] }
  return { skills: data.skills ?? [], categories: data.categories ?? [] }
}

export const listSkillCategories = async (): Promise<SkillCategoryListItem[]> => {
  const response = await fetch('/api/skill-categories', { headers: jsonHeaders })
  if (!response.ok) await throwSkillApiError(response, 'Failed to list skill categories')
  const data = (await response.json()) as { categories?: SkillCategoryListItem[] }
  return data.categories ?? []
}

export const createSkillCategory = async (input: {
  name: string
  description?: string
  sortOrder?: number
}): Promise<SkillCategoryListItem> => {
  const response = await fetch('/api/skill-categories', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to create skill category')
  const data = (await response.json()) as { category?: SkillCategoryListItem }
  if (!data.category) throw new SkillApiError('Failed to create skill category: empty response', response.status, null, null)
  return data.category
}

export const updateSkillCategory = async (
  categoryId: string,
  patch: { name?: string; description?: string | null; sortOrder?: number },
): Promise<SkillCategoryListItem> => {
  const response = await fetch(`/api/skill-categories/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to update skill category')
  const data = (await response.json()) as { category?: SkillCategoryListItem }
  if (!data.category) throw new SkillApiError('Failed to update skill category: empty response', response.status, null, null)
  return data.category
}

export const deleteSkillCategory = async (categoryId: string): Promise<void> => {
  const response = await fetch(`/api/skill-categories/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
    headers: jsonHeaders,
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to delete skill category')
}

export interface InvocableSkill {
  name: string
  description: string
  origin: 'org' | 'platform-clone' | 'platform'
}

export const listInvocableSkills = async (): Promise<InvocableSkill[]> => {
  const response = await fetch(`${skillsBase}/invocable`, { headers: jsonHeaders })
  if (!response.ok) await throwSkillApiError(response, 'Failed to list invocable skills')
  const data = (await response.json()) as { skills?: InvocableSkill[] } | InvocableSkill[]
  return Array.isArray(data) ? data : (data.skills ?? [])
}

export interface SkillReviewFinding {
  severity: 'error' | 'warning' | 'suggestion'
  field: 'name' | 'description' | 'body'
  message: string
  fix: string
  check?: string
}

export interface SkillReviewResult {
  findings: SkillReviewFinding[] | null
  error?: string
}

export const reviewSkill = async (input: {
  name: string
  description: string
  body: string
}): Promise<SkillReviewResult> => {
  try {
    const response = await fetch(`${skillsBase}/review`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    })
    if (!response.ok) return { findings: null, error: 'review_failed' }
    return (await response.json()) as SkillReviewResult
  } catch {
    return { findings: null, error: 'review_request_failed' }
  }
}

export const createSkill = async (input: CreateSkillInput): Promise<SkillListItem> => {
  const response = await fetch(skillsBase, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to create skill')
  return (await response.json()) as SkillListItem
}

export const updateSkill = async (skillId: string, input: UpdateSkillInput): Promise<SkillListItem> => {
  const response = await fetch(`${skillsBase}/${encodeURIComponent(skillId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to update skill')
  return (await response.json()) as SkillListItem
}

export const setCuratedSkillEnabled = async (
  name: string,
  enabled: boolean,
): Promise<SkillListItem> => {
  const response = await fetch(`${skillsBase}/curated/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to update platform skill')
  const data = (await response.json()) as { skill?: SkillListItem } | SkillListItem
  return 'skill' in data && data.skill ? data.skill : (data as SkillListItem)
}

export type PlatformSkillDelivery = 'offer'

export interface PlatformSkillItem {
  id: string
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  published: boolean
  delivery: PlatformSkillDelivery
  categoryId: string | null
  createdAt: string
  updatedAt: string
}

export interface PlatformSkillInput {
  name: string
  description: string
  body: string
  metadata?: Record<string, string>
  published?: boolean
  delivery?: PlatformSkillDelivery
  categoryId?: string | null
}

const platformCategoriesBase = '/api/platform/skill-categories'

export const listPlatformSkillCategories = async (): Promise<SkillCategoryListItem[]> => {
  const response = await fetch(platformCategoriesBase, { headers: jsonHeaders })
  if (!response.ok) await throwSkillApiError(response, 'Failed to list platform skill categories')
  const data = (await response.json()) as { categories?: SkillCategoryListItem[] }
  return data.categories ?? []
}

export const createPlatformSkillCategory = async (input: {
  name: string
  description?: string
  sortOrder?: number
}): Promise<SkillCategoryListItem> => {
  const response = await fetch(platformCategoriesBase, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to create platform skill category')
  const data = (await response.json()) as { category?: SkillCategoryListItem }
  if (!data.category) throw new SkillApiError('Failed to create platform skill category: empty response', response.status, null, null)
  return data.category
}

export const updatePlatformSkillCategory = async (
  categoryId: string,
  patch: { name?: string; description?: string | null; sortOrder?: number },
): Promise<SkillCategoryListItem> => {
  const response = await fetch(`${platformCategoriesBase}/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to update platform skill category')
  const data = (await response.json()) as { category?: SkillCategoryListItem }
  if (!data.category) throw new SkillApiError('Failed to update platform skill category: empty response', response.status, null, null)
  return data.category
}

export const deletePlatformSkillCategory = async (categoryId: string): Promise<void> => {
  const response = await fetch(`${platformCategoriesBase}/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
    headers: jsonHeaders,
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to delete platform skill category')
}

const platformSkillsBase = '/api/platform/skills'

export const listPlatformSkills = async (): Promise<PlatformSkillItem[]> => {
  const response = await fetch(platformSkillsBase, { headers: jsonHeaders })
  if (!response.ok) await throwSkillApiError(response, 'Failed to list platform skills')
  const data = (await response.json()) as { skills?: PlatformSkillItem[] } | PlatformSkillItem[]
  return Array.isArray(data) ? data : (data.skills ?? [])
}

export const createPlatformSkill = async (
  input: PlatformSkillInput,
): Promise<PlatformSkillItem> => {
  const response = await fetch(platformSkillsBase, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to create platform skill')
  const data = (await response.json()) as { skill?: PlatformSkillItem } | PlatformSkillItem
  return 'skill' in data && data.skill ? data.skill : (data as PlatformSkillItem)
}

export const updatePlatformSkill = async (
  skillId: string,
  input: Partial<PlatformSkillInput>,
): Promise<PlatformSkillItem> => {
  const response = await fetch(`${platformSkillsBase}/${encodeURIComponent(skillId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to update platform skill')
  const data = (await response.json()) as { skill?: PlatformSkillItem } | PlatformSkillItem
  return 'skill' in data && data.skill ? data.skill : (data as PlatformSkillItem)
}

export const deletePlatformSkill = async (skillId: string): Promise<void> => {
  const response = await fetch(`${platformSkillsBase}/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
    headers: jsonHeaders,
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to delete platform skill')
}

export const deleteSkill = async (skillId: string): Promise<void> => {
  const response = await fetch(`${skillsBase}/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
    headers: jsonHeaders,
  })
  if (!response.ok) await throwSkillApiError(response, 'Failed to delete skill')
}
