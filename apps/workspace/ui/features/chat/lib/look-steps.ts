import type { PagePlace } from '@/features/knowledge/lib/page-place'
import type { StepDetailValue, StoredThinkingStep } from '@/lib/conversations/message-provenance'

export interface LookStepPlace {
  id: string
  place: PagePlace
  where?: string
  question?: string
  reading?: string
}

export interface LookStepGroup {
  key: string
  document: PagePlace['document']
  looks: LookStepPlace[]
}

const text = (value: StepDetailValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined
const num = (value: StepDetailValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export function lookStepPlace(step: StoredThinkingStep): LookStepPlace | null {
  if (step.kind !== 'look' || !step.detail) return null
  const detail = step.detail
  const name = text(detail.document)
  const page = num(detail.page)
  if (!name || !page || page < 1) return null
  const box = [num(detail.x), num(detail.y), num(detail.w), num(detail.h)]
  const region = box.every((value) => value !== undefined) ? (box as number[]) : null
  const imageIndex = num(detail.image_index) ?? null
  return {
    id: step.id,
    place: {
      document: {
        id: text(detail.document_id) ?? null,
        name,
        shelf: detail.shelf === 'base' ? 'base' : 'stored',
      },
      page,
      frame: imageIndex === null ? 'page' : 'image',
      region,
      imageIndex,
      revisionId: text(detail.revision_id) ?? null,
    },
    ...(text(detail.where) ? { where: text(detail.where) } : {}),
    ...(text(detail.question) ? { question: text(detail.question) } : {}),
    ...(text(detail.reading) ? { reading: text(detail.reading) } : {}),
  }
}

const sameDocument = (a: PagePlace['document'], b: PagePlace['document']): boolean =>
  a.shelf === b.shelf && (a.id && b.id ? a.id === b.id : a.name === b.name)

export function lookStepGroups(steps: readonly StoredThinkingStep[]): LookStepGroup[] {
  const groups: LookStepGroup[] = []
  let previousWasLook = false
  for (const step of steps) {
    const look = lookStepPlace(step)
    if (!look) {
      if (step.kind === 'retrieval' || step.kind === 'sources') previousWasLook = false
      continue
    }
    const last = groups.at(-1)
    if (last && previousWasLook && sameDocument(last.document, look.place.document)) last.looks.push(look)
    else groups.push({ key: look.id, document: look.place.document, looks: [look] })
    previousWasLook = true
  }
  return groups
}
