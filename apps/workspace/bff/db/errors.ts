import { MAX_CAUSE_DEPTH, databaseUnavailableCode } from '../../workers/database-unavailable.js'

export { databaseUnavailableCode }

// oxlint-disable-next-line grid/no-restricted-syntax -- the one place the SQLSTATE is spelled
export const UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return violates(error, UNIQUE_VIOLATION, constraint)
}

export const FOREIGN_KEY_VIOLATION = '23503'

export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  return violates(error, FOREIGN_KEY_VIOLATION, constraint)
}

function violates(error: unknown, sqlstate: string, constraint: string | undefined): boolean {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const { code, constraint_name: name } = current as { code: unknown; constraint_name?: unknown }
      if (code === sqlstate) return constraint === undefined || name === constraint
    }
    current = current instanceof Error ? current.cause : undefined
  }
  return false
}
