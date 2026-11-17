export function residencyCell(): string | null {
  const value = process.env.RESIDENCY_CELL?.trim()
  return value ? value : null
}
