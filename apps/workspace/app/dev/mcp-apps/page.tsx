import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { McpAppsPreview } from './preview'

async function viewDocument(): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), 'mcp-app-views', 'proposal-card.html'), 'utf8')
  } catch {
    return null
  }
}

export default async function McpAppsPreviewPage() {
  const html = await viewDocument()
  if (!html) {
    return (
      <main className="p-8 text-sm">
        The view is not built. Run <code>bun run build:mcp-apps</code> in <code>apps/workspace</code>.
      </main>
    )
  }
  return <McpAppsPreview html={html} />
}
