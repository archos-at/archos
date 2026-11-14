/**
 * The brand surfaces pass axe with the WCAG 2.0 to 2.2 A and AA rule sets.
 *
 * jsdom has no layout, so `color-contrast` cannot run here; it is held by the
 * browser audit over the /dev routes (`scripts/a11y-audit.mjs`, `task
 * workspace:a11y`). Everything structural (names, roles, headings, landmarks)
 * is checked here on every run.
 */
import { render } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'
import { Logo } from './logo'
import { StatusDrawing } from './status-drawing'
import { StatusScreen } from './status-screen'

async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`)
}

describe('brand surfaces, accessibility', () => {
  it('the logo in each kind has an accessible name', async () => {
    for (const kind of ['wordmark', 'icon'] as const) {
      const { container, unmount } = render(<Logo kind={kind} />)
      expect(await violations(container)).toEqual([])
      unmount()
    }
  })

  it('a status screen has one heading and reachable actions', async () => {
    const { container } = render(
      <StatusScreen
        code="404"
        title="Not found"
        description="The page does not exist."
        actions={<Button>Back</Button>}
      />,
    )
    expect(await violations(container)).toEqual([])
  })

  it('a status screen with its drawing keeps one heading; the drawing is decoration', async () => {
    for (const kind of ['missing', 'closed', 'fault'] as const) {
      const { container, unmount } = render(
        <StatusScreen
          art={<StatusDrawing kind={kind} />}
          code="404"
          title="Not found"
          description="The page does not exist."
          actions={<Button>Back</Button>}
          detail="Reference: 1234"
        />,
      )
      expect(await violations(container)).toEqual([])
      expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      expect(container.querySelectorAll('h1, h2, h3')).toHaveLength(1)
      unmount()
    }
  })
})
