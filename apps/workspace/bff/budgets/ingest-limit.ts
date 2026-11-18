import 'server-only'

export const INGEST_ALLOWANCE_FACTOR = 3

export const ingestLimitOf = (limits: { monthlyLimit: number | null }): number | null =>
  limits.monthlyLimit === null ? null : limits.monthlyLimit * INGEST_ALLOWANCE_FACTOR
