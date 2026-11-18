import 'server-only'
import { count, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { projects } from '@/lib/db/schema/projects'
import { getWorkOS } from '@/lib/workos/client'
import {
  EMPTY_SPEND_WINDOW,
  getDailySpendTrend,
  getSpendAcrossOrganizations,
  sumSpendWindows,
  type DailySpendPoint,
  type SpendWindow,
} from '@/lib/budgets/service'
import { getEffectivePricing } from '@/lib/pricing/service'
import { getPlatformOrganizationId } from '@/lib/authz/platform'

export interface PlatformOrganization {
  id: string
  name: string
  createdAt: string
  isPlatformOrg: boolean
  projectCount: number
  day: SpendWindow
  month: SpendWindow
}


export interface PlatformOverview {
  organizations: PlatformOrganization[]
  organizationsCapped: boolean
  dailyTrend: DailySpendPoint[]
  totals: {
    organizations: number
    projects: number
    day: SpendWindow
    month: SpendWindow
  }
  pricing: { marginMultiplier: number; usdPerCredit: number; explicit: boolean }
}

async function projectCountsByOrganization(): Promise<Map<string, number>> {
  const db = getDb()
  const rows = await withPlatformAccess('platform overview: project counts for every organization', () =>
    db
      .select({ organizationId: projects.organizationId, projectCount: count() })
      .from(projects)
      .where(isNull(projects.deletedAt))
      .groupBy(projects.organizationId),
  )
  return new Map(rows.map((row) => [row.organizationId, Number(row.projectCount)]))
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const workos = getWorkOS()
  const [orgList, projectCounts, spend, platformOrgId, dailyTrend, pricing] = await Promise.all([
    workos.organizations.listOrganizations({ limit: 100 }),
    projectCountsByOrganization(),
    getSpendAcrossOrganizations(),
    getPlatformOrganizationId(),
    getDailySpendTrend({ days: 30 }),
    getEffectivePricing(),
  ])
  const spendByOrg = new Map(spend.map((entry) => [entry.organizationId, entry]))

  const organizations: PlatformOrganization[] = orgList.data
    .map((org) => {
      const orgSpend = spendByOrg.get(org.id)
      return {
        id: org.id,
        name: org.name,
        createdAt: org.createdAt.toISOString(),
        isPlatformOrg: org.id === platformOrgId,
        projectCount: projectCounts.get(org.id) ?? 0,
        day: orgSpend?.day ?? EMPTY_SPEND_WINDOW,
        month: orgSpend?.month ?? EMPTY_SPEND_WINDOW,
      }
    })
    .sort((a, b) => b.month.priceUsd - a.month.priceUsd || a.name.localeCompare(b.name))

  return {
    organizations,
    organizationsCapped: Boolean(orgList.listMetadata?.after),
    dailyTrend,
    totals: {
      organizations: organizations.length,
      projects: organizations.reduce((total, org) => total + org.projectCount, 0),
      day: sumSpendWindows(organizations.map((org) => org.day)),
      month: sumSpendWindows(organizations.map((org) => org.month)),
    },
    pricing: {
      marginMultiplier: pricing.marginMultiplier,
      usdPerCredit: pricing.usdPerCredit,
      explicit: pricing.explicit,
    },
  }
}
