import type { AiProvenanceMarking } from '@/lib/ai-provenance'
import type { DocumentBranding } from './branding'
import type { GeneratedRendering } from './generated'

export const AGENT_DOCUMENT_MEDIA_TYPE = 'text/markdown'

export function renderAgentDocumentMarkdown(
  body: string,
  marking: AiProvenanceMarking,
  branding: DocumentBranding,
): GeneratedRendering {
  const footer = [
    `**${branding.productName} — ${branding.tagline}**`,
    branding.prose,
    branding.disclaimer,
    branding.footerLine,
  ].join('\n\n')
  const text =
    `${branding.headerLine}\n\n*${branding.aiDisclosure}*\n\n${body.trim()}\n\n---\n\n${footer}\n\n` +
    `<!-- ${branding.aiGeneratorName} -->\n\n\`\`\`\n${marking}\n\`\`\`\n`
  return {
    bytes: new TextEncoder().encode(text),
    contentType: AGENT_DOCUMENT_MEDIA_TYPE,
    marking,
  }
}
