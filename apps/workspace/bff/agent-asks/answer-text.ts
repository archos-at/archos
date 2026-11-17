import { stripDirectives, type ProjectKey } from '@/lib/text/answer-directives'
import { stripCardMarkers } from '@/lib/text/card-markers'

export const VERIFICATION_MARKERS = {
  '[nicht wörtlich in der Quelle belegt]': '(quote not found verbatim in the source)',
  '[Beleg nicht verifiziert]': '(citation not verified)',
} as const

export function answerTextForAgent(
  content: string,
  options: { projectValue?: (key: ProjectKey) => string | null } = {}
): string {
  let text = content
  for (const [marker, plain] of Object.entries(VERIFICATION_MARKERS)) text = text.split(marker).join(plain)
  return stripDirectives(stripCardMarkers(text), { projectValue: options.projectValue })
}
