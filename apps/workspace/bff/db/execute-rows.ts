export function executeRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  throw new TypeError(
    '[db] execute() resolved to a non-array. This driver (postgres-js) returns a RowList; ' +
      'a `{ rows }` object is the node-postgres shape and means a stub, not the database.'
  )
}
