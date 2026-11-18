const DEFAULT_FILENAME = 'report'
const MAX_LENGTH = 100

export function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, MAX_LENGTH) || DEFAULT_FILENAME
  )
}
