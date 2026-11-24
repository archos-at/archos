import { Inbox } from 'lucide-react'
import { describe, expect, test } from 'vitest'
import { render, screen } from '@/test-utils'
import { EmptyState } from './empty-state'

describe('an empty state stands still when it mounts', () => {
  test('neither the panel nor its glyph plays an entrance, so a switch of place never replays one', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Noch keine Dateien" />)

    expect(screen.getByText('Noch keine Dateien')).toBeVisible()
    expect(container.querySelectorAll('.animate-in')).toHaveLength(0)
  })
})
