import 'server-only'
import { canManageSkills } from '@/lib/authz/organizations'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Skill, SkillOrigin } from '@/lib/db/schema/jobs'
import type { SkillCategoryRow } from '@/lib/db/schema/skill-categories'
import * as repository from './repository'
import * as categoryRepository from './skill-category-repository'
import * as platformRepository from './platform-repository'
import {
  CHAT_SKILL_AGENT,
  KNOWN_SKILL_AGENTS,
  METADATA_AGENTS,
  canonicalSkillAgent,
  isCuratedPlatformSkill,
  type CreateCategoryInput,
  type CreateSkillInput,
  type PatchCategoryInput,
  type PatchSkillInput,
  type SkillCategoryListItem,
  type SkillSnapshot,
} from './types'
import { operationScorer, queryLineMatcher } from '@/lib/text/operation-search'
import { canonicalSkillName, findSkillNamed, readMetadata } from './legacy-names'
import { findPlatformSkill, listPlatformSkills, type PlatformSkill } from './platform-skills'

function assertSkillsFeatureOn(session: AuthorizedSession): void {
  if (requireSkillsEnabled(session)) {
    throw new ForbiddenError('Agent Skills is disabled.')
  }
}

export type SkillListItem = {
  id: string | null
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  origin: SkillOrigin | 'platform'
  enabled: boolean
  clonedFrom: string | null
  categoryId: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

type CuratedSkill = Pick<PlatformSkill, 'name' | 'description' | 'body' | 'metadata'> & {
  categoryId: string | null
  collection?: string
}

type LivePlatformSkills = {
  offers: CuratedSkill[]
}

function toCurated(row: {
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  categoryId?: string | null
}): CuratedSkill {
  return {
    name: row.name,
    description: row.description,
    body: row.body,
    metadata: { ...row.metadata },
    categoryId: row.categoryId ?? null,
  }
}

async function livePlatformSkills(): Promise<LivePlatformSkills> {
  const offerRows = await platformRepository.listPublishedOfferRows()
  const offers = new Map<string, CuratedSkill>()
  for (const file of listPlatformSkills()) {
    if (isCuratedPlatformSkill(file.metadata))
      offers.set(file.name, { ...toCurated(file), collection: file.collection })
  }
  for (const row of offerRows) {
    if (findPlatformSkill(row.name)) continue
    offers.set(row.name, toCurated(row))
  }
  return { offers: [...offers.values()] }
}

async function curatedOffers(): Promise<CuratedSkill[]> {
  return (await livePlatformSkills()).offers
}

function platformToListItem(
  platform: CuratedSkill,
  enabled: boolean,
  categoryId: string | null,
): SkillListItem {
  return {
    id: null,
    name: platform.name,
    description: platform.description,
    body: platform.body,
    metadata: { ...platform.metadata },
    origin: 'platform',
    enabled,
    clonedFrom: null,
    categoryId,
    createdAt: null,
    updatedAt: null,
  }
}

function fileOfferDefaultsOn(name: string): boolean {
  const file = findPlatformSkill(name)
  if (!file || !isCuratedPlatformSkill(file.metadata)) return false
  return skillTargetsAgent(file.metadata, CHAT_SKILL_AGENT)
}

function isActivated(
  activations: { skillName: string; enabled: boolean }[],
  name: string,
): boolean {
  const row = activations.find((activation) => activation.skillName === name)
  if (row) return row.enabled
  return fileOfferDefaultsOn(name)
}

function orgToListItem(skill: Skill): SkillListItem {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    metadata: { ...skill.metadata },
    origin: skill.origin,
    enabled: skill.enabled,
    clonedFrom: skill.clonedFrom,
    categoryId: skill.categoryId,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
}

function toCategoryListItem(row: SkillCategoryRow): SkillCategoryListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    slug: row.slug,
    sortOrder: row.sortOrder,
    scope: row.organizationId === null ? 'platform' : 'org',
  }
}

function fileOfferCategoryId(
  collection: string | undefined,
  platformCategories: SkillCategoryListItem[],
): string | null {
  if (!collection) return null
  const folded = collection.trim().toLowerCase()
  return (
    platformCategories.find(
      (category) => category.slug !== null && category.slug.toLowerCase() === folded,
    )?.id ?? null
  )
}

export async function listSkills(
  session: AuthorizedSession,
): Promise<{ skills: SkillListItem[]; categories: SkillCategoryListItem[] }> {
  assertSkillsFeatureOn(session)
  const [rows, activations, offers, categoryRows] = await Promise.all([
    repository.listSkillsInOrg(session.organizationId),
    repository.listCuratedSkillActivations(session.organizationId),
    curatedOffers(),
    categoryRepository.listCategoriesForOrg(session.organizationId),
  ])
  const categories = categoryRows.map(toCategoryListItem)
  const platformCategories = categories.filter((category) => category.scope === 'platform')
  const byName = new Map<string, SkillListItem>()
  for (const offer of offers) {
    const categoryId =
      offer.categoryId ?? fileOfferCategoryId(offer.collection, platformCategories)
    byName.set(offer.name, platformToListItem(offer, isActivated(activations, offer.name), categoryId))
  }
  for (const row of rows) {
    byName.set(row.name, orgToListItem(row))
  }
  return { skills: [...byName.values()], categories }
}

export async function setCuratedSkillEnabled(
  session: AuthorizedSession,
  name: string,
  enabled: boolean,
): Promise<{ skill: SkillListItem }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const offer = findSkillNamed(await curatedOffers(), name)
  if (!offer) throw new NotFoundError(`Unknown platform skill "${name}".`)

  await repository.upsertCuratedSkillActivation({
    organizationId: session.organizationId,
    skillName: offer.name,
    enabled,
    updatedBy: session.userId,
    updatedByEmail: session.email,
  })
  const platformCategories = (
    await categoryRepository.listCategoriesForOrg(session.organizationId)
  )
    .map(toCategoryListItem)
    .filter((category) => category.scope === 'platform')
  const categoryId = offer.categoryId ?? fileOfferCategoryId(offer.collection, platformCategories)
  return { skill: platformToListItem(offer, enabled, categoryId) }
}

export type InvocableSkill = {
  name: string
  description: string
  origin: SkillOrigin | 'platform'
}

export async function listInvocableSkills(
  session: AuthorizedSession,
): Promise<{ skills: InvocableSkill[] }> {
  assertSkillsFeatureOn(session)
  const { skills } = await resolveSelectableSkills(session.organizationId, CHAT_SKILL_AGENT)
  return {
    skills: skills
      .map(({ name, description, origin }) => ({ name, description, origin }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }
}

export const SKILL_SEARCH_LINES = 3
const SKILL_SEARCH_LINE_CHARS = 200

export type SkillSearchHit = {
  name: string
  description: string
  origin: SkillOrigin | 'platform'
  lines: { line: number; text: string }[]
}

function matchingLines(body: string, matches: (line: string) => boolean): SkillSearchHit['lines'] {
  const hits: SkillSearchHit['lines'] = []
  const lines = body.split('\n')
  for (let index = 0; index < lines.length && hits.length < SKILL_SEARCH_LINES; index += 1) {
    const text = lines[index].trim()
    if (!text || !matches(text)) continue
    const cut = text.length > SKILL_SEARCH_LINE_CHARS ? `${text.slice(0, SKILL_SEARCH_LINE_CHARS - 1)}…` : text
    hits.push({ line: index + 1, text: cut })
  }
  return hits
}

export async function searchSkills(
  session: AuthorizedSession,
  query: string,
  limit: number,
): Promise<{ skills: SkillSearchHit[]; total: number }> {
  assertSkillsFeatureOn(session)
  const { skills } = await resolveSelectableSkills(session.organizationId)
  const searchable = skills.map((skill) => ({ skill, text: { name: skill.name, summary: skill.description, description: skill.body } }))
  const score = operationScorer(query, searchable.map((entry) => entry.text))
  const matchesLine = queryLineMatcher(query)
  const ranked = searchable
    .map((entry) => ({ skill: entry.skill, score: score(entry.text) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
  return {
    total: ranked.length,
    skills: ranked.slice(0, limit).map(({ skill }) => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      lines: matchingLines(skill.body, matchesLine),
    })),
  }
}

export async function readSkill(
  session: AuthorizedSession,
  name: string,
): Promise<{ skill: { name: string; description: string; origin: SkillOrigin | 'platform'; body: string } }> {
  assertSkillsFeatureOn(session)
  const { skills } = await resolveSelectableSkills(session.organizationId)
  const wanted = name.trim().toLowerCase()
  const skill =
    skills.find((candidate) => candidate.name.toLowerCase() === wanted) ?? findSkillNamed(skills, wanted)
  if (!skill) throw new NotFoundError(`Unknown skill "${name}".`)
  return { skill: { name: skill.name, description: skill.description, origin: skill.origin, body: skill.body } }
}

async function assertCategoryInScope(
  organizationId: string,
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (categoryId === undefined || categoryId === null) return null
  const category = await categoryRepository.findCategoryInScope(categoryId, organizationId)
  if (!category) throw new NotFoundError('Skill category not found.')
  return category.id
}

export async function createSkill(
  session: AuthorizedSession,
  input: CreateSkillInput,
): Promise<{ skill: Skill }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const existing = await repository.findSkillByName(input.name, session.organizationId)
  if (existing) {
    throw new ConflictError(`A skill named "${input.name}" already exists in this organization.`)
  }
  const categoryId = await assertCategoryInScope(session.organizationId, input.categoryId)

  const skill = await repository.insertSkill({
    organizationId: session.organizationId,
    name: input.name,
    description: input.description,
    body: input.body,
    metadata: input.metadata ?? {},
    origin: input.clonedFrom ? 'platform-clone' : 'org',
    clonedFrom: input.clonedFrom ?? null,
    categoryId,
    enabled: input.enabled ?? true,
    createdBy: session.userId,
    createdByEmail: session.email,
  })
  return { skill }
}

export async function updateSkill(
  session: AuthorizedSession,
  skillId: string,
  patch: PatchSkillInput,
): Promise<{ skill: Skill }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const existing = await repository.findSkill(skillId, session.organizationId)
  if (!existing) throw new NotFoundError('Skill not found.')

  if (patch.name !== undefined && patch.name !== existing.name) {
    const other = await repository.findSkillByName(patch.name, session.organizationId)
    if (other) throw new ConflictError(`A skill named "${patch.name}" already exists in this organization.`)
  }

  const { categoryId, ...rest } = patch
  const skill = await repository.updateSkill(skillId, session.organizationId, {
    ...rest,
    ...(categoryId !== undefined
      ? { categoryId: await assertCategoryInScope(session.organizationId, categoryId) }
      : {}),
    updatedAt: new Date(),
  })
  if (!skill) throw new NotFoundError('Skill not found.')
  return { skill }
}

export async function deleteSkill(
  session: AuthorizedSession,
  skillId: string,
): Promise<{ deleted: true }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const existing = await repository.findSkill(skillId, session.organizationId)
  if (!existing) throw new NotFoundError('Skill not found.')
  await repository.deleteSkill(skillId, session.organizationId)
  return { deleted: true }
}

export async function listSkillCategories(
  session: AuthorizedSession,
): Promise<{ categories: SkillCategoryListItem[] }> {
  assertSkillsFeatureOn(session)
  const rows = await categoryRepository.listCategoriesForOrg(session.organizationId)
  return { categories: rows.map(toCategoryListItem) }
}

export async function createSkillCategory(
  session: AuthorizedSession,
  input: CreateCategoryInput,
): Promise<{ category: SkillCategoryListItem }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const existing = await categoryRepository.findOrgCategoryByName(input.name, session.organizationId)
  if (existing) {
    throw new ConflictError(`A category named "${input.name}" already exists in this organization.`)
  }
  const own = await categoryRepository.listOrgCategories(
    session.organizationId,
    categoryRepository.CATEGORIES_LIST_LIMIT + 1,
  )
  if (own.length >= categoryRepository.CATEGORIES_LIST_LIMIT) {
    throw new ConflictError(
      `Category limit reached (${categoryRepository.CATEGORIES_LIST_LIMIT}). Remove an unused category before adding another.`
    )
  }
  const row = await categoryRepository.insertCategory(
    categoryRepository.orgCategoryValues(session.organizationId, {
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdBy: session.userId,
      createdByEmail: session.email,
    }),
  )
  return { category: toCategoryListItem(row) }
}

export async function updateSkillCategory(
  session: AuthorizedSession,
  categoryId: string,
  patch: PatchCategoryInput,
): Promise<{ category: SkillCategoryListItem }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const existing = await categoryRepository.findOrgCategory(categoryId, session.organizationId)
  if (!existing) throw new NotFoundError('Skill category not found.')

  if (patch.name !== undefined && patch.name !== existing.name) {
    const other = await categoryRepository.findOrgCategoryByName(patch.name, session.organizationId)
    if (other) {
      throw new ConflictError(`A category named "${patch.name}" already exists in this organization.`)
    }
  }
  const row = await categoryRepository.updateCategory(categoryId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    updatedAt: new Date(),
  })
  if (!row) throw new NotFoundError('Skill category not found.')
  return { category: toCategoryListItem(row) }
}

export async function deleteSkillCategory(
  session: AuthorizedSession,
  categoryId: string,
): Promise<{ deleted: true }> {
  assertSkillsFeatureOn(session)
  if (!canManageSkills(session)) throw new ForbiddenError('You need org skills management rights.')

  const existing = await categoryRepository.findOrgCategory(categoryId, session.organizationId)
  if (!existing) throw new NotFoundError('Skill category not found.')
  await categoryRepository.deleteCategory(categoryId)
  return { deleted: true }
}

export async function resolveSkillSnapshot(
  name: string,
  organizationId: string,
): Promise<SkillSnapshot> {
  const orgSkill = await repository.findSkillByName(name, organizationId)
  if (orgSkill) {
    return {
      name: orgSkill.name,
      description: orgSkill.description,
      body: orgSkill.body,
      metadata: { ...orgSkill.metadata },
      origin: orgSkill.origin,
    }
  }
  const platform = findPlatformSkill(name) ?? findPlatformSkill(canonicalSkillName(name))
  if (platform && !isCuratedPlatformSkill(platform.metadata)) {
    return {
      name: platform.name,
      description: platform.description,
      body: platform.body,
      metadata: {},
      origin: 'platform',
    }
  }

  const offer = findSkillNamed(await curatedOffers(), name)
  if (offer) {
    const activations = await repository.listCuratedSkillActivations(organizationId)
    if (!isActivated(activations, offer.name)) {
      throw new NotFoundError(`Unknown skill "${name}".`)
    }
    return {
      name: offer.name,
      description: offer.description,
      body: offer.body,
      metadata: { ...offer.metadata },
      origin: 'platform',
    }
  }
  throw new NotFoundError(`Unknown skill "${name}".`)
}

export type ResolvedSkill = {
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  origin: SkillOrigin | 'platform'
}

async function resolveAll(
  organizationId: string,
  agent?: string,
): Promise<{ skills: ResolvedSkill[] }> {
  const [rows, activations, live] = await Promise.all([
    repository.listSkillsInOrg(organizationId),
    repository.listCuratedSkillActivations(organizationId),
    livePlatformSkills(),
  ])
  const byName = new Map<string, ResolvedSkill>()
  const put = (skill: CuratedSkill, origin: SkillOrigin | 'platform') => {
    if (agent && !skillTargetsAgent(skill.metadata, agent)) return
    byName.set(skill.name, {
      name: skill.name,
      description: skill.description,
      body: skill.body,
      metadata: { ...skill.metadata },
      origin,
    })
  }

  const machinery = listPlatformSkills()
    .filter((skill) => !isCuratedPlatformSkill(skill.metadata))
    .map(toCurated)
  const taken = live.offers.filter((offer) => isActivated(activations, offer.name))
  for (const platform of [...taken, ...machinery]) put(platform, 'platform')

  for (const row of rows) {
    if (!row.enabled) continue
    if (agent && !skillTargetsAgent(row.metadata, agent)) continue
    byName.set(row.name, {
      name: row.name,
      description: row.description,
      body: row.body,
      metadata: { ...row.metadata },
      origin: row.origin,
    })
  }

  return { skills: [...byName.values()] }
}

export async function resolveSkillsForAgent(
  organizationId: string,
  agent?: string,
): Promise<{ skills: ResolvedSkill[] }> {
  const { skills } = await resolveAll(organizationId, agent)
  return { skills }
}

function isBuiltinMachinery(name: string): boolean {
  const file = findPlatformSkill(name)
  return Boolean(file && !isCuratedPlatformSkill(file.metadata))
}

export async function resolveSelectableSkills(
  organizationId: string,
  agent?: string,
): Promise<{ skills: ResolvedSkill[] }> {
  const { skills } = await resolveAll(organizationId, agent)
  return {
    skills: skills.filter(
      (skill) => skill.origin !== 'platform' || !isBuiltinMachinery(skill.name),
    ),
  }
}

function skillTargetsAgent(metadata: Record<string, string>, agent: string): boolean {
  const raw = readMetadata(metadata, METADATA_AGENTS)
  if (!raw) return true
  const listed = raw
    .split(',')
    .map((part) => canonicalSkillAgent(part.trim()))
    .filter((part) => part.length > 0)
  const known = listed.filter((name) => (KNOWN_SKILL_AGENTS as readonly string[]).includes(name))
  return known.length === 0 || known.includes(canonicalSkillAgent(agent))
}
