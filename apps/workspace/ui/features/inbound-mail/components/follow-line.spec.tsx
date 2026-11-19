import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files',
  useSearchParams: () => new URLSearchParams(),
}))

import { render, screen, within } from '@/test-utils'
import { MAIL_THREAD_VARIANTS, PROJECT_ID, THREAD_DOCUMENT_ID, THREAD_FOLDER_ID, VIEWER_ID, fixtureMailThreadClient } from '@/app/dev/mail-thread/fixtures'
import { MailThreadTab } from '@/features/documents/components/mail-thread'
import { FollowLine } from './follow-line'

describe('filing replies without a click, in „Übersicht“ and in the Verlauf’s „E-Mails“ tab', () => {
  it('is one switch with one label, one explanation and its state, the same in both places', async () => {
    const fixture = MAIL_THREAD_VARIANTS['three-messages']
    render(
      <>
        <section data-testid="dialog">
          <FollowLine follow onFollow={() => undefined} />
        </section>
        <section data-testid="tab">
          <MailThreadTab
            projectId={PROJECT_ID}
            documentId={THREAD_DOCUMENT_ID}
            threadId={fixture.view.id}
            folderId={THREAD_FOLDER_ID}
            viewerUserId={VIEWER_ID}
            client={fixtureMailThreadClient(fixture)}
          />
        </section>
      </>
    )
    const inDialog = within(screen.getByTestId('dialog')).getByRole('switch')
    const inTab = await within(screen.getByTestId('tab')).findByRole('switch')
    expect(inDialog).toHaveAccessibleName('File replies in this mail thread without a click')
    expect(inTab).toHaveAccessibleName('File replies in this mail thread without a click')
    expect(inDialog).toBeChecked()
    expect(inTab).toBeChecked()
    const explanation = (section: string): string | null | undefined => screen.getByTestId(section).querySelector('[id$="-explain"]')?.textContent
    expect(explanation('dialog')).toBeTruthy()
    expect(explanation('dialog')).toBe(explanation('tab'))
    expect(inDialog).toHaveAccessibleDescription(`On ${explanation('dialog')}`)
    expect(screen.getByTestId('filing-follow-state')).toHaveTextContent(/^On$/)
    expect(screen.getByTestId('mail-thread-follow-switch-state')).toHaveTextContent(/^On until /)
  })
})
