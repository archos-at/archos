import 'server-only'
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { budgetPolicies, llmUsageEvents, llmUsageRollups, INGEST_USAGE_ACTIVITY, UNBILLED_USAGE_ACTIVITIES, type BudgetPolicy, type BudgetScope, type BudgetUnit, type NewLlmUsageEvent } from '@/lib/db/schema/budgets'

export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function utcMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function findActivePolicy(
  organizationId: string,
  scope: BudgetScope,
  subjectId: string | null,
  unit: BudgetUnit,
): Promise<BudgetPolicy | null> {
  const db = getDb()
  const subjectCondition =
    subjectId === null ? isNull(budgetPolicies.subjectId) : eq(budgetPolicies.subjectId, subjectId)
  const [row] = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.organizationId, organizationId),
        eq(budgetPolicies.scope, scope),
        subjectCondition,
        eq(budgetPolicies.status, 'active'),
        eq(budgetPolicies.currency, unit),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listActivePolicies(organizationId: string, unit: BudgetUnit): Promise<BudgetPolicy[]> {
  const db = getDb()
  return db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.organizationId, organizationId),
        eq(budgetPolicies.status, 'active'),
        eq(budgetPolicies.currency, unit),
      ),
    )
    .orderBy(budgetPolicies.scope, budgetPolicies.subjectId)
}

export async function listPolicyHistory(organizationId: string, limit = 100): Promise<BudgetPolicy[]> {
  const db = getDb()
  return db
    .select()
    .from(budgetPolicies)
    .where(eq(budgetPolicies.organizationId, organizationId))
    .orderBy(desc(budgetPolicies.createdAt))
    .limit(limit)
}

export async function insertPolicySuperseding(values: {
  organizationId: string
  scope: BudgetScope
  subjectId: string | null
  unit: BudgetUnit
  dailyLimit: string | null
  monthlyLimit: string | null
  createdBy: string
  note: string | null
}): Promise<BudgetPolicy> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const subjectCondition =
      values.subjectId === null ? isNull(budgetPolicies.subjectId) : eq(budgetPolicies.subjectId, values.subjectId)
    const [previous] = await tx
      .select()
      .from(budgetPolicies)
      .where(
        and(
          eq(budgetPolicies.organizationId, values.organizationId),
          eq(budgetPolicies.scope, values.scope),
          subjectCondition,
          eq(budgetPolicies.status, 'active'),
          eq(budgetPolicies.currency, values.unit),
        ),
      )
      .limit(1)
    if (previous) {
      await tx.update(budgetPolicies).set({ status: 'superseded' }).where(eq(budgetPolicies.id, previous.id))
    }
    const [inserted] = await tx
      .insert(budgetPolicies)
      .values({
        organizationId: values.organizationId,
        scope: values.scope,
        subjectId: values.subjectId,
        dailyLimit: values.dailyLimit,
        monthlyLimit: values.monthlyLimit,
        currency: values.unit,
        status: 'active',
        supersedesId: previous?.id ?? null,
        createdBy: values.createdBy,
        note: values.note,
      })
      .returning()
    return inserted
  })
}

export async function supersedeActivePolicy(
  organizationId: string,
  scope: 'member' | 'project',
  subjectId: string,
  unit: BudgetUnit,
): Promise<boolean> {
  const db = getDb()
  const [previous] = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.organizationId, organizationId),
        eq(budgetPolicies.scope, scope),
        eq(budgetPolicies.subjectId, subjectId),
        eq(budgetPolicies.status, 'active'),
        eq(budgetPolicies.currency, unit),
      ),
    )
    .limit(1)
  if (!previous) return false
  await db.update(budgetPolicies).set({ status: 'superseded' }).where(eq(budgetPolicies.id, previous.id))
  return true
}

function utcDayOf(createdAt: Date | undefined): string {
  return (createdAt ?? new Date()).toISOString().slice(0, 10)
}

const num = (value: string | number | null | undefined): number => Number.parseFloat(String(value ?? '0')) || 0

interface RollupIncrement {
  organizationId: string
  day: string
  userId: string
  projectId: string
  costUsd: number
  ownKeyCostUsd: number
  priceUsd: number
  credits: number
  tokens: number
  events: number
  ingestCredits: number
  ingestTokens: number
  ingestEvents: number
}

export function buildRollupIncrements(events: NewLlmUsageEvent[]): RollupIncrement[] {
  const byKey = new Map<string, RollupIncrement>()
  for (const event of events) {
    if (event.activity && UNBILLED_USAGE_ACTIVITIES.has(event.activity)) continue
    const day = utcDayOf(event.createdAt ?? undefined)
    const userId = event.userId ?? ''
    const projectId = event.projectId ?? ''
    const key = `${event.organizationId} ${day} ${userId} ${projectId}`
    const entry = byKey.get(key) ?? {
      organizationId: event.organizationId,
      day,
      userId,
      projectId,
      costUsd: 0,
      ownKeyCostUsd: 0,
      priceUsd: 0,
      credits: 0,
      tokens: 0,
      events: 0,
      ingestCredits: 0,
      ingestTokens: 0,
      ingestEvents: 0,
    }
    entry.costUsd += num(event.costUsd)
    if (event.isByok === true) entry.ownKeyCostUsd += num(event.costUsd)
    entry.priceUsd += num(event.priceUsd)
    entry.credits += num(event.credits)
    entry.tokens += event.totalTokens ?? 0
    entry.events += 1
    if (event.activity === INGEST_USAGE_ACTIVITY) {
      entry.ingestCredits += num(event.credits)
      entry.ingestTokens += event.totalTokens ?? 0
      entry.ingestEvents += 1
    }
    byKey.set(key, entry)
  }
  return [...byKey.values()]
}

export async function insertUsageEventsWithRollups(events: NewLlmUsageEvent[]): Promise<number> {
  if (events.length === 0) return 0
  const db = getDb()
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(llmUsageEvents).values(events).returning({ id: llmUsageEvents.id })

    for (const increment of buildRollupIncrements(events)) {
      const costUsd = increment.costUsd.toFixed(8)
      const ownKeyCostUsd = increment.ownKeyCostUsd.toFixed(8)
      const priceUsd = increment.priceUsd.toFixed(8)
      const credits = increment.credits.toFixed(6)
      const ingestCredits = increment.ingestCredits.toFixed(6)
      await tx
        .insert(llmUsageRollups)
        .values({
          organizationId: increment.organizationId,
          day: increment.day,
          userId: increment.userId,
          projectId: increment.projectId,
          costUsd,
          ownKeyCostUsd,
          priceUsd,
          credits,
          tokens: increment.tokens,
          events: increment.events,
          ingestCredits,
          ingestTokens: increment.ingestTokens,
          ingestEvents: increment.ingestEvents,
        })
        .onConflictDoUpdate({
          target: [
            llmUsageRollups.organizationId,
            llmUsageRollups.day,
            llmUsageRollups.userId,
            llmUsageRollups.projectId,
          ],
          set: {
            costUsd: sql`${llmUsageRollups.costUsd} + ${costUsd}`,
            ownKeyCostUsd: sql`${llmUsageRollups.ownKeyCostUsd} + ${ownKeyCostUsd}`,
            priceUsd: sql`${llmUsageRollups.priceUsd} + ${priceUsd}`,
            credits: sql`${llmUsageRollups.credits} + ${credits}`,
            tokens: sql`${llmUsageRollups.tokens} + ${increment.tokens}`,
            events: sql`${llmUsageRollups.events} + ${increment.events}`,
            ingestCredits: sql`${llmUsageRollups.ingestCredits} + ${ingestCredits}`,
            ingestTokens: sql`${llmUsageRollups.ingestTokens} + ${increment.ingestTokens}`,
            ingestEvents: sql`${llmUsageRollups.ingestEvents} + ${increment.ingestEvents}`,
            updatedAt: new Date(),
          },
        })
    }

    return inserted.length
  })
}

export interface SpendWindow {
  costUsd: number
  ownKeyCostUsd: number
  priceUsd: number
  credits: number
  tokens: number
  events: number
  ingestCredits?: number
  ingestTokens?: number
  ingestEvents?: number
  ingestCostUsd?: number
  dictationCostUsd?: number
}

export const EMPTY_SPEND_WINDOW: SpendWindow = {
  costUsd: 0,
  ownKeyCostUsd: 0,
  priceUsd: 0,
  credits: 0,
  tokens: 0,
  events: 0,
  ingestCredits: 0,
  ingestTokens: 0,
  ingestEvents: 0,
  ingestCostUsd: 0,
  dictationCostUsd: 0,
}
const EMPTY_WINDOW = EMPTY_SPEND_WINDOW

export interface SpendTotals {
  day: SpendWindow
  month: SpendWindow
}

export async function sumRollupTotals(
  organizationId: string,
  filter: { userId?: string; projectId?: string } = {},
): Promise<SpendTotals> {
  const db = getDb()
  const dayStr = utcDayStart().toISOString().slice(0, 10)
  const monthStr = utcMonthStart().toISOString().slice(0, 10)

  const conditions = [eq(llmUsageRollups.organizationId, organizationId), gte(llmUsageRollups.day, monthStr)]
  if (filter.userId) conditions.push(eq(llmUsageRollups.userId, filter.userId))
  if (filter.projectId) conditions.push(eq(llmUsageRollups.projectId, filter.projectId))

  const isToday = sql`${llmUsageRollups.day} = ${dayStr}`
  const [row] = await db
    .select({
      monthCostUsd: sql<string>`coalesce(sum(${llmUsageRollups.costUsd}), 0)`,
      monthOwnKeyCostUsd: sql<string>`coalesce(sum(${llmUsageRollups.ownKeyCostUsd}), 0)`,
      monthPriceUsd: sql<string>`coalesce(sum(${llmUsageRollups.priceUsd}), 0)`,
      monthCredits: sql<string>`coalesce(sum(${llmUsageRollups.credits}), 0)`,
      monthTokens: sql<string>`coalesce(sum(${llmUsageRollups.tokens}), 0)`,
      monthEvents: sql<string>`coalesce(sum(${llmUsageRollups.events}), 0)`,
      monthIngestCredits: sql<string>`coalesce(sum(${llmUsageRollups.ingestCredits}), 0)`,
      monthIngestTokens: sql<string>`coalesce(sum(${llmUsageRollups.ingestTokens}), 0)`,
      monthIngestEvents: sql<string>`coalesce(sum(${llmUsageRollups.ingestEvents}), 0)`,
      dayCostUsd: sql<string>`coalesce(sum(${llmUsageRollups.costUsd}) filter (where ${isToday}), 0)`,
      dayOwnKeyCostUsd: sql<string>`coalesce(sum(${llmUsageRollups.ownKeyCostUsd}) filter (where ${isToday}), 0)`,
      dayPriceUsd: sql<string>`coalesce(sum(${llmUsageRollups.priceUsd}) filter (where ${isToday}), 0)`,
      dayCredits: sql<string>`coalesce(sum(${llmUsageRollups.credits}) filter (where ${isToday}), 0)`,
      dayTokens: sql<string>`coalesce(sum(${llmUsageRollups.tokens}) filter (where ${isToday}), 0)`,
      dayEvents: sql<string>`coalesce(sum(${llmUsageRollups.events}) filter (where ${isToday}), 0)`,
      dayIngestCredits: sql<string>`coalesce(sum(${llmUsageRollups.ingestCredits}) filter (where ${isToday}), 0)`,
      dayIngestTokens: sql<string>`coalesce(sum(${llmUsageRollups.ingestTokens}) filter (where ${isToday}), 0)`,
      dayIngestEvents: sql<string>`coalesce(sum(${llmUsageRollups.ingestEvents}) filter (where ${isToday}), 0)`,
    })
    .from(llmUsageRollups)
    .where(and(...conditions))

  if (!row) return { day: EMPTY_WINDOW, month: EMPTY_WINDOW }
  return toWindows(row)
}

function windowColumns(dayStartIso: string) {
  const isToday = sql`${llmUsageEvents.createdAt} >= ${dayStartIso}`
  const ownKey = sql`${llmUsageEvents.isByok} = true`
  const ingest = sql`${llmUsageEvents.activity} = ${INGEST_USAGE_ACTIVITY}`
  const platformIngest = sql`${llmUsageEvents.activity} = 'ingest' and ${llmUsageEvents.isByok} is not true`
  const platformDictation = sql`${llmUsageEvents.activity} = 'dictation' and ${llmUsageEvents.isByok} is not true`
  return {
    monthIngestCredits: sql<string>`coalesce(sum(${llmUsageEvents.credits}) filter (where ${ingest}), 0)`,
    monthIngestTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}) filter (where ${ingest}), 0)`,
    monthIngestEvents: sql<string>`count(*) filter (where ${ingest})`,
    dayIngestCredits: sql<string>`coalesce(sum(${llmUsageEvents.credits}) filter (where ${isToday} and ${ingest}), 0)`,
    dayIngestTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}) filter (where ${isToday} and ${ingest}), 0)`,
    dayIngestEvents: sql<string>`count(*) filter (where ${isToday} and ${ingest})`,
    monthIngestCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${platformIngest}), 0)`,
    dayIngestCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${isToday} and ${platformIngest}), 0)`,
    monthDictationCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${platformDictation}), 0)`,
    dayDictationCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${isToday} and ${platformDictation}), 0)`,
    monthCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)`,
    monthOwnKeyCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${ownKey}), 0)`,
    monthPriceUsd: sql<string>`coalesce(sum(${llmUsageEvents.priceUsd}), 0)`,
    monthCredits: sql<string>`coalesce(sum(${llmUsageEvents.credits}), 0)`,
    monthTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}), 0)`,
    monthEvents: sql<string>`count(*)`,
    dayCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${isToday}), 0)`,
    dayOwnKeyCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${isToday} and ${ownKey}), 0)`,
    dayPriceUsd: sql<string>`coalesce(sum(${llmUsageEvents.priceUsd}) filter (where ${isToday}), 0)`,
    dayCredits: sql<string>`coalesce(sum(${llmUsageEvents.credits}) filter (where ${isToday}), 0)`,
    dayTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}) filter (where ${isToday}), 0)`,
    dayEvents: sql<string>`count(*) filter (where ${isToday})`,
  }
}

interface WindowRow {
  monthCostUsd: string
  monthOwnKeyCostUsd: string
  monthPriceUsd: string
  monthCredits: string
  monthTokens: string
  monthEvents: string
  dayCostUsd: string
  dayOwnKeyCostUsd: string
  dayPriceUsd: string
  dayCredits: string
  dayTokens: string
  dayEvents: string
  monthIngestCredits: string
  monthIngestTokens: string
  monthIngestEvents: string
  dayIngestCredits: string
  dayIngestTokens: string
  dayIngestEvents: string
  monthIngestCostUsd?: string
  dayIngestCostUsd?: string
  monthDictationCostUsd?: string
  dayDictationCostUsd?: string
}

function toWindows(row: WindowRow): { day: SpendWindow; month: SpendWindow } {
  return {
    day: {
      costUsd: num(row.dayCostUsd),
      ownKeyCostUsd: num(row.dayOwnKeyCostUsd),
      priceUsd: num(row.dayPriceUsd),
      credits: num(row.dayCredits),
      tokens: num(row.dayTokens),
      events: num(row.dayEvents),
      ingestCredits: num(row.dayIngestCredits),
      ingestTokens: num(row.dayIngestTokens),
      ingestEvents: num(row.dayIngestEvents),
      ...(row.dayIngestCostUsd !== undefined ? { ingestCostUsd: num(row.dayIngestCostUsd) } : {}),
      ...(row.dayDictationCostUsd !== undefined ? { dictationCostUsd: num(row.dayDictationCostUsd) } : {}),
    },
    month: {
      costUsd: num(row.monthCostUsd),
      ownKeyCostUsd: num(row.monthOwnKeyCostUsd),
      priceUsd: num(row.monthPriceUsd),
      credits: num(row.monthCredits),
      tokens: num(row.monthTokens),
      events: num(row.monthEvents),
      ingestCredits: num(row.monthIngestCredits),
      ingestTokens: num(row.monthIngestTokens),
      ingestEvents: num(row.monthIngestEvents),
      ...(row.monthIngestCostUsd !== undefined ? { ingestCostUsd: num(row.monthIngestCostUsd) } : {}),
      ...(row.monthDictationCostUsd !== undefined ? { dictationCostUsd: num(row.monthDictationCostUsd) } : {}),
    },
  }
}

export const sumSpendWindows = (windows: SpendWindow[]): SpendWindow =>
  windows.reduce(
    (total, w) => ({
      costUsd: total.costUsd + w.costUsd,
      ownKeyCostUsd: total.ownKeyCostUsd + w.ownKeyCostUsd,
      priceUsd: total.priceUsd + w.priceUsd,
      credits: total.credits + w.credits,
      tokens: total.tokens + w.tokens,
      events: total.events + w.events,
      ingestCredits: (total.ingestCredits ?? 0) + (w.ingestCredits ?? 0),
      ingestTokens: (total.ingestTokens ?? 0) + (w.ingestTokens ?? 0),
      ingestEvents: (total.ingestEvents ?? 0) + (w.ingestEvents ?? 0),
      ingestCostUsd: (total.ingestCostUsd ?? 0) + (w.ingestCostUsd ?? 0),
      dictationCostUsd: (total.dictationCostUsd ?? 0) + (w.dictationCostUsd ?? 0),
    }),
    EMPTY_WINDOW,
  )
const sumWindows = sumSpendWindows

export interface ModelSpend {
  model: string
  day: SpendWindow
  month: SpendWindow
}

export interface SpendSummary {
  day: SpendWindow
  month: SpendWindow
  perModel: ModelSpend[]
}

export async function aggregateSpendSummary(
  organizationId: string,
  filter: { userId?: string; projectId?: string } = {},
): Promise<SpendSummary> {
  const db = getDb()
  const monthStart = utcMonthStart()
  const dayStartIso = utcDayStart().toISOString()

  const conditions = [eq(llmUsageEvents.organizationId, organizationId), gte(llmUsageEvents.createdAt, monthStart)]
  if (filter.userId) conditions.push(eq(llmUsageEvents.userId, filter.userId))
  if (filter.projectId) conditions.push(eq(llmUsageEvents.projectId, filter.projectId))

  const modelColumn = sql`coalesce(${llmUsageEvents.model}, 'unknown')`
  const rows = await db
    .select({ model: sql<string>`${modelColumn}`, ...windowColumns(dayStartIso) })
    .from(llmUsageEvents)
    .where(and(...conditions))
    .groupBy(modelColumn)

  const perModel: ModelSpend[] = rows
    .map((row) => ({ model: row.model, ...toWindows(row) }))
    .sort((a, b) => b.month.tokens - a.month.tokens)

  return {
    day: sumWindows(perModel.map((m) => m.day)),
    month: sumWindows(perModel.map((m) => m.month)),
    perModel,
  }
}

export interface MemberSpend {
  userId: string
  day: SpendWindow
  month: SpendWindow
}

export async function aggregateSpendByMember(organizationId: string): Promise<MemberSpend[]> {
  const db = getDb()
  const dayStartIso = utcDayStart().toISOString()
  const monthStart = utcMonthStart()

  const rows = await db
    .select({ userId: llmUsageEvents.userId, ...windowColumns(dayStartIso) })
    .from(llmUsageEvents)
    .where(
      and(
        eq(llmUsageEvents.organizationId, organizationId),
        gte(llmUsageEvents.createdAt, monthStart),
        isNotNull(llmUsageEvents.userId),
      ),
    )
    .groupBy(llmUsageEvents.userId)

  return rows
    .map((row) => ({ userId: row.userId as string, ...toWindows(row) }))
    .sort((a, b) => b.month.tokens - a.month.tokens)
}

export interface OrganizationSpend {
  organizationId: string
  day: SpendWindow
  month: SpendWindow
}

export async function aggregateSpendAcrossOrganizations(): Promise<OrganizationSpend[]> {
  const db = getDb()
  const dayStartIso = utcDayStart().toISOString()
  const monthStart = utcMonthStart()

  const rows = await db
    .select({ organizationId: llmUsageEvents.organizationId, ...windowColumns(dayStartIso) })
    .from(llmUsageEvents)
    .where(gte(llmUsageEvents.createdAt, monthStart))
    .groupBy(llmUsageEvents.organizationId)

  return rows
    .map((row) => ({ organizationId: row.organizationId, ...toWindows(row) }))
    .sort((a, b) => b.month.priceUsd - a.month.priceUsd)
}

export interface DailySpendRow extends SpendWindow {
  day: string
}

export async function aggregateDailySpend(options: {
  organizationId?: string
  start: Date
}): Promise<DailySpendRow[]> {
  const db = getDb()
  const conditions = [gte(llmUsageEvents.createdAt, options.start)]
  if (options.organizationId) {
    conditions.push(eq(llmUsageEvents.organizationId, options.organizationId))
  }
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${llmUsageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      costUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)`,
      ownKeyCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${llmUsageEvents.isByok} = true), 0)`,
      priceUsd: sql<string>`coalesce(sum(${llmUsageEvents.priceUsd}), 0)`,
      credits: sql<string>`coalesce(sum(${llmUsageEvents.credits}), 0)`,
      tokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}), 0)`,
      events: sql<string>`count(*)`,
      ingestCredits: sql<string>`coalesce(sum(${llmUsageEvents.credits}) filter (where ${llmUsageEvents.activity} = ${INGEST_USAGE_ACTIVITY}), 0)`,
      ingestTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}) filter (where ${llmUsageEvents.activity} = ${INGEST_USAGE_ACTIVITY}), 0)`,
      ingestEvents: sql<string>`count(*) filter (where ${llmUsageEvents.activity} = ${INGEST_USAGE_ACTIVITY})`,
      ingestCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${llmUsageEvents.activity} = 'ingest' and ${llmUsageEvents.isByok} is not true), 0)`,
      dictationCostUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}) filter (where ${llmUsageEvents.activity} = 'dictation' and ${llmUsageEvents.isByok} is not true), 0)`,
    })
    .from(llmUsageEvents)
    .where(and(...conditions))
    .groupBy(sql`1`)

  return rows.map((row) => ({
    day: row.day,
    costUsd: num(row.costUsd),
    ownKeyCostUsd: num(row.ownKeyCostUsd),
    priceUsd: num(row.priceUsd),
    credits: num(row.credits),
    tokens: num(row.tokens),
    events: num(row.events),
    ingestCredits: num(row.ingestCredits),
    ingestTokens: num(row.ingestTokens),
    ingestEvents: num(row.ingestEvents),
    ingestCostUsd: num(row.ingestCostUsd),
    dictationCostUsd: num(row.dictationCostUsd),
  }))
}
