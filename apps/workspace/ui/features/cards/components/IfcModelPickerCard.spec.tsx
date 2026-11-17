import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { IfcModelPickerCard } from './IfcModelPickerCard'

const model = (filename: string, status = 'ready', extra: Record<string, unknown> = {}) => ({
  id: `id-${filename}`,
  documentId: `doc-${filename}`,
  projectId: 'p',
  filename,
  displayName: null,
  status,
  schemaVersion: 'IFC4',
  elementCount: 3,
  errorMessage: null,
  summary: null,
  updatedAt: '2026-02-11T09:00:00.000Z',
  ...extra,
})

function stubFetch(models: unknown | 'fail' | 'never'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/bim/models')) {
        if (models === 'never') return new Promise(() => {})
        if (models === 'fail') return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, json: async () => models }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

let nextProject = 0
const picker = (props: Partial<React.ComponentProps<typeof IfcModelPickerCard>> = {}) =>
  render(
    <IfcModelPickerCard
      title="Welches Modell?"
      note={null}
      projectId={`p${(nextProject += 1)}`}
      {...props}
    />
  )

describe('IfcModelPickerCard', () => {
  it('renders one tile per ready model, each a link into the viewer', async () => {
    stubFetch({ models: [model('haus-a.ifc'), model('haus-b.ifc')] })
    picker()

    const links = await screen.findAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('/files?model=haus-a.ifc'))
    expect(links[1]).toHaveAttribute('href', expect.stringContaining('/files?model=haus-b.ifc'))
  })

  it('offers only models that can actually be opened', async () => {
    stubFetch({
      models: [model('ready.ifc', 'ready'), model('busy.ifc', 'extracting'), model('broken.ifc', 'failed')],
    })
    picker()

    const links = await screen.findAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('model=ready.ifc'))
  })

  it('renders nothing — not an empty picker — when the project has no readable model', async () => {
    stubFetch({ models: [] })
    const { container } = picker()
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('says the list could not be read, rather than silently rendering nothing', async () => {
    stubFetch('fail')
    picker()
    await waitFor(() =>
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
    )
  })
})
