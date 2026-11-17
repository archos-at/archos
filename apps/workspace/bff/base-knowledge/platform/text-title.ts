import { nameOf } from '../chain/text'

export function releasedTextTitle(designation: string | null, workTitle: string | null, editionLabel: string | null): string | null {
  const work = nameOf(designation) || nameOf(workTitle)
  const label = nameOf(editionLabel)
  if (!work) return null
  return label && label !== work ? `${work}, ${label}` : work
}
