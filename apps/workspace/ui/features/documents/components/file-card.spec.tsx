import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects/proj-1/files',
  useSearchParams: () => new URLSearchParams(),
}))

import { render, screen } from '@/test-utils'
import { FileCard } from './file-card'
import type { FileItem } from './project-file-workspace'

const doc: FileItem = {
  id: 'doc-1',
  filename: 'Brandschutzkonzept_Wohnbau-Nord.pdf',
  displayName: null,
  fileSize: 2_400_000,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-06-01T09:00:00Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
}

const classesOf = (element: Element | null): string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('the tile footer on a 156px phone tile', () => {
  it('cuts the age with an ellipsis inside the tile, never past its edge', () => {
    render(<FileCard file={doc} isSelected={false} onSelect={vi.fn()} locale="de" />)
    const age = screen.getByTestId('file-card-footer').querySelector('time')
    expect(classesOf(age)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']))
    for (let box = age?.parentElement ?? null; box && box.dataset.testid !== 'file-card-footer'; box = box.parentElement) {
      expect(classesOf(box), 'a box round the age keeps its full width').not.toContain('shrink-0')
      expect(classesOf(box)).toContain('min-w-0')
    }
  })
})
