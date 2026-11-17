export function workDesignation(designation: string | null): string | null {
  return designation?.replace(/\s*:\s*\d{4}(-\d{2}){0,2}$/, '') ?? null
}
