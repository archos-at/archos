/**
 * A work's designation without one edition's date (`ÖNORM B 1600:2017` →
 * `ÖNORM B 1600`): the work spans its editions, and each edition says its own
 * through its label. The `:year` suffix is how standards bodies cite an edition.
 */
export function workDesignation(designation: string | null): string | null {
  return designation?.replace(/\s*:\s*\d{4}(-\d{2}){0,2}$/, '') ?? null
}
