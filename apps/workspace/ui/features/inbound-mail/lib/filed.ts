import type { InboundMailPartView } from '@/lib/inbound-mail/inbound-mail-wire'

export interface FiledPlace {
  name: string
  folder: string
  version: number | null
}

export function filedPlace(part: Pick<InboundMailPartView, 'filedAs'> & Partial<Pick<InboundMailPartView, 'kind'>>, rootLabel: string): FiledPlace | null {
  if (!part.filedAs) return null
  const { name, folderPath, version } = part.filedAs
  return { name, folder: folderPath && folderPath !== '' ? folderPath : rootLabel, version: part.kind === 'message' ? null : version }
}

export type FiledLine = { kind: 'attachment' | 'message'; place: FiledPlace }

export function filedLines(parts: readonly InboundMailPartView[], partIds: readonly string[], rootLabel: string): FiledLine[] {
  const wanted = new Set(partIds)
  return parts
    .filter((part) => wanted.has(part.id) && part.state === 'filed')
    .sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === 'message' ? -1 : 1))
    .flatMap((part) => {
      const place = filedPlace(part, rootLabel)
      return place ? [{ kind: part.kind, place }] : []
    })
}
