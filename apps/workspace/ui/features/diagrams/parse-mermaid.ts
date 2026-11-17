import { modelFromParsed, type DiagramModel } from './model'
import { withMermaid } from './render-diagram'

interface MermaidParserApi {
  initialize: (config: Record<string, unknown>) => void
  mermaidAPI: {
    getDiagramFromText: (text: string) => Promise<{ type: string; db: Record<string, unknown> }>
  }
}

export async function parseMermaid(source: string): Promise<DiagramModel | null> {
  return withMermaid(async () => {
    const mermaid = (await import('mermaid')).default as unknown as MermaidParserApi
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    try {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
      return modelFromParsed(diagram)
    } catch {
      return null
    }
  })
}
