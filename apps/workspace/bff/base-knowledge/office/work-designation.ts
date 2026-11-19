export function workDesignation(designation: string | null): string | null {
  return designation?.replace(/\s*:\s*\d{4}(-\d{2}){0,2}$/, '') ?? null
}

export function designationKey(designation: string): string {
  return designation.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim().replace(/:\d{4}(-\d{2}(-\d{2})?)?$/, '')
}
