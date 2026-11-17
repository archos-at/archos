import type { getDb } from './index'

export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

export type DbExecutor = ReturnType<typeof getDb> | DbTransaction
