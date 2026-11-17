const FORMULA_LEAD = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const inert = FORMULA_LEAD.test(text) ? `'${text}` : text
  return `"${inert.replace(/"/g, '""')}"`
}
