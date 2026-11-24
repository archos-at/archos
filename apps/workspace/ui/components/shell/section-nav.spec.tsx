import { describe, expect, it, vi } from 'vitest'
import { FileText, ListTodo, Mail } from 'lucide-react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => new URLSearchParams(),
}))

import { render, screen } from '@/test-utils'
import { SectionNav } from './section-nav'

const items = [
  { key: 'files', label: 'Dateien', href: '/app/projects/p1/files', icon: FileText },
  { key: 'mail', label: 'E-Mail-Eingang', href: '/app/projects/p1/files/mail', icon: Mail, count: 3 },
  { key: 'open-points', label: 'Offene Punkte', href: '/app/projects/p1/files/open-points', icon: ListTodo },
]

describe('a head of word tabs on a phone, where only the open place is named', () => {
  it('keeps every glyph-only tab a 44px square to a finger', () => {
    render(<SectionNav label="Ablage" items={items} rootHref="/app/projects/p1/files" pillId="p" orientation="tabs" words compactOnPhone />)
    const glyphOnly = screen.getByRole('link', { name: 'Offene Punkte' })
    expect(glyphOnly).not.toHaveAttribute('aria-current')
    expect(glyphOnly).toHaveClass('pointer-coarse:min-h-11', 'pointer-coarse:min-w-11', 'justify-center')
  })
})
