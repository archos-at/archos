import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePreviewPane } from './file-preview-pane'
import { mockFile } from './file-preview-pane.fixtures'

describe('FilePreviewPane', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the "Read by" panel', () => {
    it('loads the per-page drawing descriptions with the document, under "On the pages"', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/visual-details')) {
          return {
            ok: true,
            json: async () => ({
              details: [
                {
                  page: 1,
                  contentType: 'drawing',
                  drawingType: 'schnitt',
                  scale: '1:100',
                  text: 'Ein Längsschnitt.',
                },
              ],
            }),
          } as Response
        }
        return {
          ok: true,
          json: async () => ({ url: 'https://example.test/plan.pdf' }),
        } as Response
      })

      render(
        <FilePreviewPane
          file={{ ...mockFile, contentTypes: ['text', 'drawing'] }}
          projectId="proj-1"
        />
      )

      expect(screen.queryByRole('button', { name: /detailed information/i })).toBeNull()
      const pages = within(await screen.findByRole('region', { name: 'On the pages' }))
      expect(await pages.findByText('Ein Längsschnitt.')).toBeDefined()
      expect(pages.getByLabelText('Page 1')).toHaveTextContent('p. 1')
      expect(pages.getByText('Schnitt')).toBeDefined()
      expect(pages.getByText('Scale 1:100')).toBeDefined()
    })

    it('neither shows "On the pages" nor asks for descriptions when the document has no visual chunks', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) } as Response)
      render(<FilePreviewPane file={{ ...mockFile, contentTypes: ['text'] }} projectId="proj-1" />)
      expect(screen.queryByTestId('page-readings')).toBeNull()
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/visual-details'))).toBe(false)
    })

    describe('turning to a page from its reading', () => {
      beforeEach(() => vi.stubGlobal('IntersectionObserver', undefined))
      afterEach(() => vi.unstubAllGlobals())

      const withReading = (detail: Record<string, unknown>, previewUrl: string) =>
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
          String(input).includes('/visual-details')
            ? ({ ok: true, json: async () => ({ details: [detail] }) } as Response)
            : ({ ok: true, json: async () => ({ url: previewUrl }) } as Response),
        )

      it('links each reading to its page where the well is the PDF viewer', async () => {
        withReading(
          { page: 7, contentType: 'drawing', drawingType: 'floor_plan', scale: '1:100', text: 'Regelgeschoss.' },
          'https://example.test/plan.pdf',
        )
        render(<FilePreviewPane file={{ ...mockFile, contentTypes: ['text', 'drawing'] }} projectId="proj-1" />)
        expect((await screen.findByTitle('Show page 7 in the document')).tagName).toBe('BUTTON')
      })

      it('offers no page link where the well is not the PDF viewer', async () => {
        withReading(
          { page: 1, contentType: 'image', drawingType: 'photo', scale: '', text: 'Ein Baustellenfoto.' },
          'https://example.test/photo.jpg',
        )
        render(
          <FilePreviewPane
            file={{ ...mockFile, filename: 'Baustelle.jpg', contentType: 'image/jpeg', contentTypes: ['image'] }}
            projectId="proj-1"
          />
        )
        expect(await screen.findByText('Ein Baustellenfoto.')).toBeDefined()
        expect(screen.queryByTitle(/show page/i)).toBeNull()
      })
    })

    it('asks for no descriptions when the metadata panel is off', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) } as Response)
      render(
        <FilePreviewPane
          file={{ ...mockFile, contentTypes: ['text', 'drawing'] }}
          projectId="proj-1"
          showMetadataPanel={false}
        />
      )
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/visual-details'))).toBe(false)
    })

    it('translates a drawing type it knows', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
        String(input).includes('/visual-details')
          ? ({
              ok: true,
              json: async () => ({ details: [{ page: 3, contentType: 'drawing', drawingType: 'site_plan', scale: '', text: 'Lageplan.' }] }),
            } as Response)
          : ({ ok: false, json: async () => ({}) } as Response),
      )
      render(<FilePreviewPane file={{ ...mockFile, contentTypes: ['drawing'] }} projectId="proj-1" />)
      expect(await screen.findByText('Site plan')).toBeDefined()
      expect(screen.queryByText(/site_plan/)).toBeNull()
    })

    it('marks which of the sheet\'s depictions a row is when a sheet carries several', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/visual-details')) {
          return {
            ok: true,
            json: async () => ({
              details: [
                {
                  page: 1,
                  contentType: 'drawing',
                  drawingType: 'floor_plan',
                  scale: '1:100',
                  text: 'Erdgeschoss.',
                  segment: 0,
                  segmentCount: 2,
                },
                {
                  page: 1,
                  contentType: 'drawing',
                  drawingType: 'floor_plan',
                  scale: '1:100',
                  text: 'Obergeschoss.',
                  segment: 1,
                  segmentCount: 2,
                },
              ],
            }),
          } as Response
        }
        return {
          ok: true,
          json: async () => ({ url: 'https://example.test/plan.pdf' }),
        } as Response
      })

      render(
        <FilePreviewPane
          file={{ ...mockFile, contentTypes: ['text', 'drawing'] }}
          projectId="proj-1"
        />
      )

      expect(await screen.findByText('Erdgeschoss.')).toBeDefined()
      expect(screen.getByText('Obergeschoss.')).toBeDefined()
      expect(screen.getByText('· 1/2')).toBeDefined()
      expect(screen.getByText('· 2/2')).toBeDefined()
    })

    const mockVisualDetails = (details: unknown[]) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/visual-details')) {
          return { ok: true, json: async () => ({ details }) } as Response
        }
        return {
          ok: true,
          json: async () => ({ url: 'https://example.test/plan.pdf' }),
        } as Response
      })
    }

    const structuredDetail = {
      page: 2,
      contentType: 'drawing',
      drawingType: 'floor_plan',
      scale: '1:100',
      segment: 0,
      text: 'Grundriss des Erdgeschosses.',
      structured: {
        schemaVersion: 4,
        registry: 'architecture+general@abc123',
        segment: {
          domain: 'architecture',
          segmentType: 'floor_plan',
          title: 'EG',
          scale: '1:100',
          summary: 'Grundriss des Erdgeschosses.',
          entityGroups: [
            {
              category: 'space',
              entities: [
                { name: 'Atelier', category: 'space', role: 'Arbeiten', measure: '24,5 m²' },
              ],
            },
            {
              category: 'site_plant',
              entities: [{ name: 'Turmkran', category: 'site_plant', role: null, measure: null }],
            },
          ],
          compositions: [
            {
              component: 'Außenwand',
              layers: [{ material: 'Stahlbeton', thickness: '20 cm', purpose: 'tragend' }],
            },
          ],
          states: [{ element: 'Bestandsmauer', state: 'existing' }],
          quantities: [
            {
              object: 'Bausubstanz erhalten',
              property: 'Anteil',
              value: '71',
              unit: '%',
              source: 'text',
              confidence: 'high',
            },
          ],
          relations: [{ subject: 'Rampe', relation: 'verbindet', object: 'Hof und Dach' }],
          annotations: [],
          source: 'visual',
          confidence: 'medium',
        },
        document: {
          title: 'Bildungscampus',
          subtitle: null,
          slogans: [],
          author: null,
          institution: null,
          supervision: null,
          location: null,
          strategies: [],
          processSteps: [],
        },
      },
    }

    it('reveals the structured analysis behind an advanced disclosure', async () => {
      mockVisualDetails([structuredDetail])
      render(
        <FilePreviewPane
          file={{ ...mockFile, contentTypes: ['text', 'drawing'] }}
          projectId="proj-1"
        />
      )

      await screen.findByText('Grundriss des Erdgeschosses.')

      expect(screen.queryByText(/Atelier/)).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: /structured data/i }))

      expect(screen.getByText('Atelier (Arbeiten, 24,5 m²)')).toBeDefined()
      expect(screen.getByText('Spaces and uses')).toBeDefined()
      expect(screen.getByText('Site plant')).toBeDefined()
      expect(screen.getByText('Turmkran')).toBeDefined()
      expect(screen.getByText('Stahlbeton 20 cm (tragend)')).toBeDefined()
      expect(screen.getByText('Bestandsmauer: existing')).toBeDefined()
      expect(screen.getByText('Bausubstanz erhalten — Anteil')).toBeDefined()
      expect(screen.getByText('71 %')).toBeDefined()
      expect(screen.getByText('Rampe → verbindet → Hof und Dach')).toBeDefined()
      expect(screen.getByText('read from the drawing · confidence medium')).toBeDefined()
    })

    it('offers no advanced disclosure when there is nothing beyond the description', async () => {
      mockVisualDetails([
        {
          page: 1,
          contentType: 'image',
          drawingType: '',
          scale: '',
          segment: 0,
          text: 'Ein Baustellenfoto.',
          structured: {
            schemaVersion: 4,
            registry: 'architecture+general@abc123',
            segment: {
              domain: 'general',
              segmentType: 'photo',
              title: null,
              scale: null,
              summary: 'Ein Baustellenfoto.',
              entityGroups: [],
              compositions: [],
              states: [],
              quantities: [],
              relations: [],
              annotations: [],
              source: null,
              confidence: null,
            },
            document: {
              title: null,
              subtitle: null,
              slogans: [],
              author: null,
              institution: null,
              supervision: null,
              location: null,
              strategies: [],
              processSteps: [],
            },
          },
        },
      ])
      render(
        <FilePreviewPane
          file={{ ...mockFile, contentTypes: ['text', 'image'] }}
          projectId="proj-1"
        />
      )

      await screen.findByText('Ein Baustellenfoto.')

      expect(screen.queryByRole('button', { name: /structured data/i })).toBeNull()
    })

    it('still renders a chunk indexed before the structured schema', async () => {
      mockVisualDetails([
        {
          page: 1,
          contentType: 'drawing',
          drawingType: 'schnitt',
          scale: '1:50',
          text: 'Ein Schnitt.',
        },
      ])
      render(
        <FilePreviewPane
          file={{ ...mockFile, contentTypes: ['text', 'drawing'] }}
          projectId="proj-1"
        />
      )

      expect(await screen.findByText('Ein Schnitt.')).toBeDefined()
      expect(screen.queryByRole('button', { name: /structured data/i })).toBeNull()
    })
  })
})
