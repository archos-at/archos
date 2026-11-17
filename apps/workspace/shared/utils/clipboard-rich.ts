export async function copyMarkdownToClipboard(markdown: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard.write !== 'function') {
    await navigator.clipboard.writeText(markdown)
    return
  }

  let html: string
  try {
    const { marked } = await import('marked')
    html = await marked.parse(markdown.replace(/</g, '&lt;'), { gfm: true, breaks: false })
  } catch {
    await navigator.clipboard.writeText(markdown)
    return
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(markdown)
  }
}
