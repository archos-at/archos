import type { Translator } from '@/i18n/translate'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { screenUploadName, type NameMatch } from '@/lib/upload-screening/name-screen'
import { describeScreenedOut } from '@/lib/upload-screening/quarantine'

export interface NameScreenedFiles {
  allowed: File[]
  stopped: Array<{ file: File; matches: NameMatch[] }>
  message: string | null
}

export function screenFileNames(
  files: readonly File[],
  policy: UploadScreeningPolicy,
  t: Translator,
  options?: {
    screeningReleased?: (file: File) => boolean
    folderPathFor?: (file: File) => string | null | undefined
  }
): NameScreenedFiles {
  const stopped: Array<{ file: File; matches: NameMatch[] }> = []
  const allowed = files.filter((file) => {
    if (options?.screeningReleased?.(file)) return true
    const verdict = screenUploadName(policy, {
      filename: file.name,
      originPath: file.webkitRelativePath || null,
      folderPath: options?.folderPathFor?.(file) ?? null,
    })
    if (verdict.blocked) stopped.push({ file, matches: verdict.matches })
    return !verdict.blocked
  })
  return { allowed, stopped, message: describeScreenedOut(stopped, t) }
}

export function uploadAnywayOffer<Options extends { screeningReleased?: (file: File) => boolean }>(
  stopped: File[],
  options: Options | undefined,
  upload: (files: File[], options: Options) => Promise<number>
): { count: number; uploadAnyway: () => void } | null {
  if (stopped.length === 0) return null
  const screeningReleased = (file: File) => stopped.includes(file) || !!options?.screeningReleased?.(file)
  return { count: stopped.length, uploadAnyway: () => void upload(stopped, { ...options, screeningReleased } as Options) }
}
