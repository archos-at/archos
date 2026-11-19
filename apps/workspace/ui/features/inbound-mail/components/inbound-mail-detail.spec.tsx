import { PRODUCT_NAME } from '@/lib/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files/mail',
  useSearchParams: () => new URLSearchParams(),
}))

import { toast } from 'sonner'
import { act, render, screen, waitFor, within } from '@/test-utils'
import { ApiRequestError } from '@/adapters/api/api-error'
import { DETAIL_VARIANTS, FIXTURE_NOW, FOLDERS, PROJECT_ID, fixtureClient, mail, messagePart, text } from '@/app/dev/inbound-mail/fixtures'
import type { InboundMailClient } from '../lib/client'
import { decisionOf, initialDraft, type DraftCopy } from '../lib/draft'
import { FILING_QUICK_ROUNDS, InboundMailDetail, type DetailActions } from './inbound-mail-detail'

function renderDetail(name: string, client: InboundMailClient = fixtureClient({ detail: DETAIL_VARIANTS[name] }), onChanged = vi.fn(), actionsRef?: { current: DetailActions | null }) {
  const fixture = DETAIL_VARIANTS[name]
  render(
    <InboundMailDetail
      projectId={PROJECT_ID}
      mailId={fixture.view.id}
      initial={fixture.view}
      initialText={fixture.text}
      folders={FOLDERS}
      client={client}
      onChanged={onChanged}
      now={FIXTURE_NOW}
      pollMs={1}
      decidedByOther={fixture.decidedByOther}
      actionsRef={actionsRef}
    />
  )
  return { client, onChanged }
}

const copy: DraftCopy = { unnamedAttachment: (position) => `Attachment ${position}`, untitledThread: '(no subject)' }

const dialog = (): HTMLElement => screen.getByTestId('filing-dialog')
const stepOf = (): string | null => dialog().getAttribute('data-step')

async function openFiling(): Promise<HTMLElement> {
  await userEvent.click(screen.getByTestId('decision-open'))
  return screen.findByTestId('filing-dialog')
}

async function next(): Promise<void> {
  await userEvent.click(within(dialog()).getByTestId('filing-next'))
}

/** Walks „Einordnen“ to „Übersicht“, confirming the sender on the way where it is asked. */
async function toOverview(): Promise<void> {
  for (let guard = 0; stepOf() !== 'overview' && guard < 5; guard += 1) {
    if (stepOf() === 'sender') await userEvent.click(within(dialog()).getByTestId('acknowledge-sender'))
    await next()
  }
}

const overviewLines = (): string[] => within(dialog()).getAllByTestId('filing-overview-line').map((line) => line.textContent ?? '')

beforeEach(() => vi.clearAllMocks())

describe('the mail pane', () => {
  it('shows the mail and, per attachment, one phrase of where it goes, with nothing to tick or choose', () => {
    renderDetail('mixed-attachments')
    const pane = screen.getByTestId('inbound-mail-detail')
    expect(within(pane).queryAllByRole('checkbox')).toEqual([])
    expect(within(pane).queryAllByRole('radio')).toEqual([])
    expect(within(pane).queryByTestId('attachment-change')).toBeNull()
    expect(within(pane).queryByTestId('attachments-check-all')).toBeNull()
    const phrases = within(pane).getAllByTestId('attachment-plan').map((phrase) => phrase.textContent)
    expect(phrases).toEqual([
      'Becomes revision 4 of S-101_C.pdf',
      'Goes to Tragwerk\u00A0· Floor plan',
      'Goes to Fotos (new folder)\u00A0· Photo',
      'stays out – already in the project',
      'Goes to Tragwerk',
      'stays out – a picture in the mail text',
    ])
    expect(screen.getByTestId('not-staged')).toHaveTextContent('winmail.dat · Outlook’s own attachment')
    expect(screen.getByTestId('not-staged')).toHaveTextContent('2 pictures from the signature')
    expect(screen.getByTestId('not-staged-original')).toHaveTextContent('download it above under “Details”')
  })

  it('has one primary that names the act, and says what dismissing does', () => {
    renderDetail('member-verified')
    const open = screen.getByTestId('decision-open')
    expect(open).toHaveTextContent('Review and file …')
    expect(open.className).toContain('bg-primary')
    expect(open).toHaveAccessibleDescription('Shows what goes where first. Nothing is filed until you confirm.')
    expect(screen.getByTestId('decision-dismiss').className).not.toContain('bg-primary')
    expect(screen.getByTestId('decision-dismiss-note')).toHaveTextContent(/^Dismissing acts only in \S+, not in the mail program, and can be restored for 7 days\.$/)
    expect(screen.getByTestId('decision-dismiss')).toHaveAccessibleDescription(screen.getByTestId('decision-dismiss-note').textContent ?? '')
  })

  it('says an open question in the attachment’s phrase, and how many questions „Einordnen“ asks', () => {
    renderDetail('unverified-thread')
    expect(screen.getByTestId('attachment-plan')).toHaveTextContent('Open: could be revision 4 of S-101_C.pdf')
    expect(screen.getByTestId('decision-open-hint')).toHaveTextContent('2 questions, then the overview. Nothing is filed until you confirm.')
  })

  it('says why the mail text cannot be filed while the mail’s own malware check is not clean', () => {
    renderDetail('original-infected')
    expect(screen.getByTestId('message-scan-infected')).toHaveTextContent('The mail contains malware, so its text cannot be filed.')
    expect(screen.queryByTestId('decision-open')).toBeNull()

    const base = DETAIL_VARIANTS['member-verified']
    const failed = { ...base.view, rawScan: 'failed' as const }
    render(
      <InboundMailDetail projectId={PROJECT_ID} mailId={failed.id} initial={failed} initialText={base.text} folders={FOLDERS} client={fixtureClient({ detail: { ...base, view: failed } })} onChanged={vi.fn()} now={FIXTURE_NOW} pollMs={1} />
    )
    expect(screen.getByTestId('message-scan-failed')).toHaveTextContent('The mail’s malware check failed and is being repeated. Its text can be filed once the check passes.')
  })

  it('gives no scan reason beside a text whose mail scanned clean', () => {
    renderDetail('member-verified')
    expect(screen.queryByTestId(/^message-scan-/)).toBeNull()
  })

  it('says where each filed part went and which Fassung it became, with the way to it', () => {
    renderDetail('filed-outcome')
    expect(screen.getByTestId('message-filed')).toHaveTextContent('Filed in mail thread “Stellplatznachweis” · Open')
    expect(screen.getByTestId('message-filed')).not.toHaveTextContent('revision')
    expect(screen.getByTestId('status-filed')).toHaveTextContent('Filed in Behörde/Bescheide · revision 1 · Open')
    expect(screen.getByTestId('detail-restorable')).toHaveTextContent('1 part dismissed · can be restored until')
    expect(screen.getByTestId('detail-restorable')).not.toHaveTextContent(/^Dismissed/)
  })

  it('says a part was filed, never where, when the viewer may not see its folder', () => {
    const fixture = DETAIL_VARIANTS['filed-outcome']
    const hidden = { ...fixture.view, parts: fixture.view.parts.map((part) => ({ ...part, filedAs: null, documentId: null })) }
    render(
      <InboundMailDetail projectId={PROJECT_ID} mailId={hidden.id} initial={hidden} initialText={fixture.text} folders={FOLDERS} client={fixtureClient({ detail: { ...fixture, view: hidden } })} onChanged={vi.fn()} now={FIXTURE_NOW} />
    )
    expect(screen.getByTestId('status-filed')).toHaveTextContent('Filed in Files')
    expect(screen.getByTestId('status-filed')).not.toHaveTextContent('Behörde')
  })

  it('tells a writer an unconfirmed outsider’s dismissal is deleted at once, and offers no undo for it', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['external-unverified'] })
    renderDetail('external-unverified', client)
    expect(screen.getByTestId('decision-dismiss-note')).toHaveTextContent('With a sender that cannot be verified, what you dismiss is deleted right away.')
    await userEvent.click(screen.getByTestId('decision-dismiss'))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(vi.mocked(toast.success).mock.calls[0]?.[1]).not.toHaveProperty('action')
  })

  it('offers only „Dismiss“ where nothing can be filed: a closed project', () => {
    renderDetail('closed')
    expect(screen.getByTestId('detail-closed')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-open')).toBeNull()
    expect(screen.getByTestId('decision-dismiss').className).toContain('bg-primary')
  })

  it('states a scan that is not done and a partial failure on the attachment itself', () => {
    renderDetail('scan-pending')
    expect(screen.getByTestId('status-scan-pending')).toBeInTheDocument()
    expect(screen.getByTestId('status-scan-failed')).toBeInTheDocument()
  })

  it('says a partial failure and a full storage from the mail itself', () => {
    renderDetail('partial-failure')
    expect(screen.getByTestId('detail-partial-failure')).toHaveTextContent('1 of 2 files could not be filed.')
    expect(screen.getByTestId('note-last-failure')).toHaveTextContent('the name is already taken')
  })

  it('offers the restore of an expired mail', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS.expired })
    const restore = vi.spyOn(client, 'restore')
    renderDetail('expired', client)
    await userEvent.click(screen.getByTestId('detail-restore'))
    await waitFor(() => expect(restore).toHaveBeenCalled())
  })

  it('shows its skeleton, then its error with a retry', async () => {
    renderDetail('error', fixtureClient({ detail: DETAIL_VARIANTS.error }))
    expect(screen.getByTestId('inbound-mail-detail')).toBeInTheDocument()
    const fixture = DETAIL_VARIANTS.error
    render(<InboundMailDetail projectId={PROJECT_ID} mailId={fixture.view.id} initial={null} folders={FOLDERS} client={fixtureClient({ detail: fixture })} onChanged={vi.fn()} />)
    expect(await screen.findByText('This mail could not be loaded.')).toBeInTheDocument()
  })

  it('dismisses with an undo that restores', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['member-verified'] })
    const restore = vi.spyOn(client, 'restore')
    renderDetail('member-verified', client)
    await userEvent.click(screen.getByTestId('decision-dismiss'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mail dismissed', expect.objectContaining({ action: expect.any(Object) })))
    const action = vi.mocked(toast.success).mock.calls.at(-1)?.[1]?.action
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('the dismissal offered no undo')
    action.onClick({} as never)
    await waitFor(() => expect(restore).toHaveBeenCalled())
    expect(await screen.findByTestId('decision-bar')).toBeInTheDocument()
  })

  it('folds two or more notices into one line that opens on a tap, and says the closed project once', async () => {
    renderDetail('stacked-notices')
    expect(screen.getByTestId('detail-notices')).toHaveAttribute('data-folded', 'true')
    expect(screen.getByTestId('detail-closed-line')).toHaveTextContent('The project is closed')
    expect(screen.getByTestId('detail-notices-unfold')).toHaveTextContent('+2 notices')
    expect(screen.queryByTestId('decision-blocker')).toBeNull()
    await userEvent.click(screen.getByTestId('detail-notices-unfold'))
    expect(screen.getByTestId('detail-closed')).toBeInTheDocument()
    expect(screen.getByTestId('detail-decided-by-other')).not.toHaveClass('bg-info-subtle')
    expect(screen.getByTestId('detail-partial-failure')).toBeInTheDocument()
  })
})

describe('„Einordnen“', () => {
  it('opens straight on „Übersicht“ when nothing needs a decision, and files exactly the decision of today’s draft', async () => {
    const fixture = DETAIL_VARIANTS['member-verified']
    const client = fixtureClient({ detail: fixture })
    const file = vi.spyOn(client, 'file')
    const { onChanged } = renderDetail('member-verified', client)
    await openFiling()
    expect(stepOf()).toBe('overview')
    expect(within(dialog()).queryByTestId('filing-progress')).toBeNull()
    expect(within(dialog()).getByRole('heading', { name: 'This is how the mail is filed' })).toBeInTheDocument()
    expect(overviewLines()).toEqual([
      `Mail text → added to mail thread “Stellplatznachweis”Further replies in this mail thread are filed by ${PRODUCT_NAME} without a click.`,
      'Bescheid_MA37_2026-10-14.pdf → Behörde/Bescheide\u00A0· Official decision',
    ])
    expect(within(dialog()).queryByTestId('filing-left-note')).toBeNull()
    const primary = within(dialog()).getByTestId('decision-file')
    expect(primary).toHaveTextContent('File')
    expect(primary).toHaveFocus()
    await userEvent.click(primary)
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
    const body = file.mock.calls[0][1]
    expect(body.mails).toEqual([decisionOf(fixture.view, initialDraft(fixture.view, FOLDERS, copy))])
    expect(body.mails[0]).toMatchObject({ message: { text: 'full', thread: { action: 'append' } }, parts: [{ folderId: FOLDERS[1].id, newFolderPath: null, documentType: 'Bescheid' }] })
    expect(body.mails[0]).not.toHaveProperty('acknowledgeSender')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.queryByTestId('filing-dialog')).toBeNull()
    const [title, options] = vi.mocked(toast.success).mock.calls[0] ?? []
    expect(title).toBe('Filed 1 file and the mail text')
    expect(options?.action).toMatchObject({ label: 'View' })
    const description = options?.description
    render(<>{typeof description === 'function' ? description() : description}</>)
    const lines = screen.getAllByTestId('filed-lines').at(-1) as HTMLElement
    expect(within(lines).getAllByRole('listitem').map((line) => line.textContent)).toEqual([
      'Mail text → “Stellplatznachweis”',
      'Bescheid_MA37_2026-10-14.pdf → Behörde/Bescheide · revision 1',
    ])
  })

  it('says every part of a mixed mail, what stays out, and that filing dismisses it for 7 days', async () => {
    renderDetail('mixed-attachments')
    await openFiling()
    expect(overviewLines()).toEqual([
      expect.stringMatching(/^Mail text → added to mail thread “Stellplatznachweis”/),
      'S-101_D.pdf → revision 4 of S-101_C.pdf',
      'Grundriss_EG.dwg → Tragwerk\u00A0· Floor plan',
      'Foto_Baustelle.jpg → Fotos (new folder)\u00A0· Photo',
      'Bescheid_alt.pdf stays out – already in the project',
      'Statik_verschluesselt.pdf → Tragwerk',
      'Attachment 6 stays out – a picture in the mail text',
    ])
    expect(within(dialog()).getByTestId('filing-left-note')).toHaveTextContent(`What “stays out” is dismissed by ${PRODUCT_NAME} when you file. It can be restored for 7 days.`)
  })

  it('says a text is added to its thread, never that it becomes a revision', async () => {
    renderDetail('thread-append')
    await openFiling()
    expect(overviewLines()[0]).toMatch(/^Mail text → added to mail thread “Stellplatznachweis”/)
    expect(dialog()).not.toHaveTextContent(/revision/)
  })

  it('asks only the steps a mail needs, in order, with its progress, and closes on Escape keeping every answer', async () => {
    renderDetail('unverified-thread')
    await openFiling()
    expect(stepOf()).toBe('text')
    expect(within(dialog()).getByTestId('filing-progress')).toHaveTextContent('Step 1 of 3')
    expect(within(dialog()).getByTestId('message-row')).toHaveTextContent('leave it for someone who can see it')
    await userEvent.click(within(dialog()).getAllByRole('radio')[0])
    await next()
    expect(stepOf()).toBe('attachments')
    expect(within(dialog()).getByTestId('filing-progress')).toHaveTextContent('Step 2 of 3')
    expect(within(dialog()).getByTestId('note-revision')).toHaveTextContent('could be revision 4 of S-101_C.pdf, but only the file name says so')
    expect(within(dialog()).getByTestId('attachment-undecided')).toHaveTextContent('without a tick the file is dismissed when you file')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('filing-dialog')).toBeNull())
    expect(screen.getByTestId('decision-open')).toHaveFocus()
    await openFiling()
    expect(stepOf()).toBe('text')
    expect(within(dialog()).getAllByRole('radio')[0]).toBeChecked()
  })

  it('reopens on „Übersicht“ once the person has seen it, with what they changed', async () => {
    renderDetail('unverified-thread')
    await openFiling()
    await toOverview()
    expect(overviewLines()).toContain('S-101_D.pdf stays out')
    await userEvent.click(within(dialog()).getByTestId('filing-back'))
    await userEvent.click(within(dialog()).getByTestId('attachment-checkbox'))
    await next()
    expect(overviewLines()).toContain('S-101_D.pdf → Tragwerk')
    await userEvent.keyboard('{Escape}')
    await openFiling()
    expect(stepOf()).toBe('overview')
    expect(overviewLines()).toContain('S-101_D.pdf → Tragwerk')
    expect(screen.getByTestId('attachment-plan')).toHaveTextContent('Goes to Tragwerk')
  })

  it('files with „E“ in „Übersicht“, and opens with „E“ from the mail', async () => {
    const actionsRef = { current: null as DetailActions | null }
    const client = fixtureClient({ detail: DETAIL_VARIANTS['member-verified'] })
    const file = vi.spyOn(client, 'file')
    renderDetail('member-verified', client, vi.fn(), actionsRef)
    act(() => actionsRef.current?.file())
    expect(await screen.findByTestId('filing-dialog')).toHaveAttribute('data-step', 'overview')
    await userEvent.keyboard('e')
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
  })

  it('says why „E“ files nothing in „Übersicht“, in a live region, and files nothing', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['external-unverified'] })
    const file = vi.spyOn(client, 'file')
    renderDetail('external-unverified', client)
    await openFiling()
    expect(stepOf()).toBe('attachments')
    await next()
    expect(overviewLines()[1]).toBe('Angebot_2026.pdf → no folder yet')
    expect(within(dialog()).getByTestId('decision-file')).toBeDisabled()
    expect(within(dialog()).getByTestId('decision-blocker')).toHaveTextContent('Choose a folder for 1 attachment.')
    within(dialog()).getByTestId('filing-back').focus()
    await userEvent.keyboard('e')
    await waitFor(() => expect(within(dialog()).getByTestId('filing-announcement')).toHaveTextContent('Choose a folder for 1 attachment.'))
    expect(file).not.toHaveBeenCalled()
  })

  it('answers an attachment without folder with the project’s folders in the step, no second dialog', async () => {
    renderDetail('external-unverified')
    await openFiling()
    expect(within(dialog()).getByRole('heading', { name: 'Where does this attachment go?' })).toBeInTheDocument()
    expect(within(dialog()).getByTestId('attachment-folder')).toHaveTextContent('Folder: none yet')
    expect(within(dialog()).queryByTestId('attachment-folder-choose')).toBeNull()
    const choice = within(dialog()).getByTestId('filing-folder-choice')
    await userEvent.click(within(choice).getByTestId(`folder-picker-${FOLDERS[2].id}`))
    expect(within(dialog()).getByTestId('attachment-folder')).toHaveTextContent('Folder: Tragwerk')
    expect(within(dialog()).getByTestId('attachment-change')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-picker')).toBeNull()
    await next()
    expect(overviewLines()[1]).toBe('Angebot_2026.pdf → Tragwerk')
    expect(within(dialog()).getByTestId('decision-file')).toBeEnabled()
  })

  it('sends a plan set from an unknown sender to one folder with one pick', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['unknown-plan-set'] })
    const file = vi.spyOn(client, 'file')
    renderDetail('unknown-plan-set', client)
    await openFiling()
    expect(stepOf()).toBe('attachments')
    const choice = within(dialog()).getByTestId('filing-folder-choice')
    expect(choice).toHaveTextContent('All 3 into this folder')
    await userEvent.click(within(choice).getByTestId(`folder-picker-${FOLDERS[2].id}`))
    within(dialog())
      .getAllByTestId('attachment-folder')
      .forEach((folder) => expect(folder).toHaveTextContent('Folder: Tragwerk'))
    expect(within(dialog()).getByTestId('filing-announcement')).toBeInTheDocument()
    await next()
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    await waitFor(() => expect(file).toHaveBeenCalled())
    expect(file.mock.calls[0][1].mails[0].parts.map((part) => part.folderId)).toEqual([FOLDERS[2].id, FOLDERS[2].id, FOLDERS[2].id])
  })

  it('offers the folders the mail’s other attachments go to above the tree', async () => {
    const fixture = DETAIL_VARIANTS['unknown-plan-set']
    const [message, first, ...rest] = fixture.view.parts
    const view = { ...fixture.view, parts: [message, { ...first, suggestion: { folderId: null, folderPath: 'Tragwerk', newFolder: false, documentType: null, reason: 'Fassade' } }, ...rest] }
    render(<InboundMailDetail projectId={PROJECT_ID} mailId={view.id} initial={view} initialText={fixture.text} folders={FOLDERS} client={fixtureClient({ detail: { ...fixture, view } })} onChanged={vi.fn()} now={FIXTURE_NOW} />)
    await openFiling()
    const picks = within(dialog()).getByTestId('filing-quick-picks')
    expect(within(picks).getByTestId('filing-quick-pick-sibling')).toHaveTextContent('TragwerkFA-201_Ansicht_Ost_B.pdf goes there too')
    expect(within(dialog()).getByTestId('filing-folder-choice')).toHaveTextContent('All 2 into this folder')
  })

  it('names the attachment and the name check it needs, and files only once confirmed', async () => {
    renderDetail('name-stop')
    await openFiling()
    expect(within(dialog()).getByRole('heading', { name: 'What happens to this attachment?' })).toBeInTheDocument()
    await userEvent.click(within(dialog()).getByTestId('attachment-checkbox'))
    await next()
    expect(within(dialog()).getByTestId('decision-file')).toBeDisabled()
    expect(within(dialog()).getByTestId('decision-blocker')).toHaveTextContent('Confirm the name check for 1 attachment.')
    await userEvent.click(within(dialog()).getByTestId('filing-back'))
    await userEvent.click(within(dialog()).getByTestId('attachment-release-name'))
    await next()
    expect(within(dialog()).getByTestId('decision-file')).toBeEnabled()
  })

  it('files a text with findings masked by default, whole when chosen, its hint naming the thread it would hold back', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['content-finding'] })
    const file = vi.spyOn(client, 'file')
    renderDetail('content-finding', client)
    await openFiling()
    expect(stepOf()).toBe('text')
    const choice = within(dialog()).getByTestId('content-finding-choice')
    expect(within(within(dialog()).getByTestId('message-row')).getByTestId('content-finding-choice')).toBe(choice)
    expect(choice).toHaveTextContent('The text contains: IBAN, a term your office keeps confidential')
    expect(within(choice).getAllByRole('radio')).toHaveLength(2)
    expect(choice).toHaveTextContent('holds the whole mail thread “Honorarvereinbarung Statik” back')
    await next()
    expect(overviewLines()[0]).toMatch(/^Mail text → added to mail thread “Honorarvereinbarung Statik” \(findings redacted\)/)
    await userEvent.click(within(dialog()).getByTestId('filing-back'))
    await userEvent.click(within(dialog()).getByTestId('finding-full'))
    await next()
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    await waitFor(() => expect(file).toHaveBeenCalled())
    expect(file.mock.calls[0][1].mails[0].message?.text).toBe('full')
  })

  it('recommends filing a mail’s own words, and says when they stay out', async () => {
    renderDetail('mixed-attachments')
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('filing-change-text'))
    expect(stepOf()).toBe('text')
    expect(within(dialog()).getByTestId('message-recommended')).toHaveTextContent('(recommended)')
    await userEvent.click(within(dialog()).getByText('Include the mail text'))
    await next()
    expect(overviewLines()[0]).toBe('Mail text stays out, with the original')
  })

  it('reaches a new thread’s name and folder from „Übersicht“', async () => {
    renderDetail('external-unverified')
    await openFiling()
    await next()
    await userEvent.click(within(dialog()).getByTestId('filing-change-text'))
    expect(within(dialog()).getByTestId('detail-new-thread-folder')).toHaveTextContent('Folder: Korrespondenz')
    expect(within(dialog()).getByTestId('detail-new-thread-folder-change')).toHaveTextContent('Change')
    expect(within(dialog()).getByTestId('filing-progress')).toHaveTextContent('Step 1 of 3')
  })

  it('labels folder and Dokumentart apart, names the folder by its whole path, and offers one press', async () => {
    renderDetail('member-verified')
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('filing-change-attachments'))
    expect(stepOf()).toBe('attachments')
    expect(within(dialog()).getByTestId('attachment-folder')).toHaveTextContent('Folder: Behörde/Bescheide')
    expect(within(dialog()).getByTestId('attachment-type')).toHaveTextContent('Document type: Official decision')
    expect(within(dialog()).getAllByTestId('attachment-change')).toHaveLength(1)
    expect(within(dialog()).queryByTestId('attachment-folder-choose')).toBeNull()
  })

  it('lists the attachments with a proposal folded, and ticks a whole plan set and sends it to one folder', async () => {
    renderDetail('mixed-attachments')
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('filing-change-attachments'))
    expect(within(dialog()).getByTestId('note-duplicate')).toHaveTextContent('Already in the project: Behörde/Bescheide/Bescheid_alt.pdf')
    expect(within(dialog()).getByTestId('note-encrypted')).toBeInTheDocument()
    expect(within(dialog()).getByTestId('attachments-selected-count')).toHaveTextContent('4 of 6 selected')
    const boxes = () => within(dialog()).getAllByTestId('attachment-checkbox').filter((box) => !box.hasAttribute('disabled'))
    await userEvent.click(within(dialog()).getByTestId('attachments-check-all'))
    boxes().forEach((box) => expect(box).toBeChecked())
    expect(within(dialog()).getByTestId('attachments-check-all')).toHaveTextContent('Deselect all')
    await userEvent.click(within(dialog()).getByTestId('attachments-file-checked-into'))
    await userEvent.click(within(await screen.findByTestId('folder-picker')).getByTestId(`folder-picker-${FOLDERS[2].id}`))
    within(dialog()).getAllByTestId('attachment-folder').forEach((chip) => expect(chip).toHaveTextContent('Tragwerk'))
    await waitFor(() =>
      expect(within(dialog()).getByTestId('filing-announcement')).toHaveTextContent(`${boxes().length - 1} attachments go to “Tragwerk”. 1 stays the next revision of its document.`)
    )
  })

  it('folds the attachments with a proposal under one line while others need a decision', async () => {
    const fixture = DETAIL_VARIANTS['mixed-attachments']
    const [message, statik, ...rest] = fixture.view.parts
    const view = { ...fixture.view, parts: [message, { ...statik, suggestion: null, revisionCandidate: null, preselected: true }, ...rest] }
    render(<InboundMailDetail projectId={PROJECT_ID} mailId={view.id} initial={view} initialText={fixture.text} folders={FOLDERS} client={fixtureClient({ detail: { ...fixture, view } })} onChanged={vi.fn()} now={FIXTURE_NOW} />)
    await openFiling()
    expect(stepOf()).toBe('attachments')
    expect(within(dialog()).getAllByRole('listitem').filter((item) => item.dataset.testid?.startsWith('attachment-'))).toHaveLength(1)
    const toggle = within(dialog()).getByTestId('filing-rest-toggle')
    expect(toggle).toHaveTextContent('5 more as proposed · Change')
    await userEvent.click(toggle)
    expect(within(dialog()).getAllByTestId('attachment-checkbox')).toHaveLength(6)
  })

  it('hands the focus back to „Change“ when its dialog closes, and keeps „Einordnen“ open', async () => {
    renderDetail('member-verified')
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('filing-change-attachments'))
    const change = within(dialog()).getByTestId('attachment-change')
    await userEvent.click(change)
    expect(await screen.findByTestId('attachment-target-dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('attachment-target-dialog')).toBeNull())
    expect(change).toHaveFocus()
    expect(screen.getByTestId('filing-dialog')).toBeInTheDocument()
  })

  it('names the term the name check stopped a new thread’s name for, and goes back to the text', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['new-thread'] })
    vi.spyOn(client, 'file').mockRejectedValue(new ApiRequestError('stopped', 409, 'name_stop', { reason: 'name_stop', terms: ['Honorar'] }))
    renderDetail('new-thread', client)
    await openFiling()
    expect(stepOf()).toBe('overview')
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    expect(await within(dialog()).findByTestId('thread-name-stop')).toHaveTextContent('Name check: “Honorar”')
    expect(stepOf()).toBe('text')
    expect(within(dialog()).getByTestId('thread-release-name')).toBeInTheDocument()
  })

  it('reads the mail again when a colleague decided first, says so, and closes', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['member-verified'] })
    vi.spyOn(client, 'file').mockRejectedValue(new ApiRequestError('stale', 409, 'stale'))
    const handled = mail({ key: 'member-verified', status: 'handled', parts: [messagePart({ id: 'x', state: 'filed' })] })
    vi.spyOn(client, 'get').mockResolvedValue({ ...handled, id: DETAIL_VARIANTS['member-verified'].view.id })
    renderDetail('member-verified', client)
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    expect(await screen.findByTestId('detail-decided-by-other')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('changed in the meantime'), expect.anything())
    expect(screen.queryByTestId('decision-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('filing-dialog')).toBeNull()
  })

  it('keeps the person’s choices through a refusal’s reload when the mail kept its parts', async () => {
    const fixture = DETAIL_VARIANTS['member-verified']
    const client = fixtureClient({ detail: fixture })
    const file = vi.spyOn(client, 'file').mockRejectedValueOnce(new ApiRequestError('stale', 409, 'stale'))
    vi.spyOn(client, 'get').mockResolvedValue({ ...fixture.view, ifMatch: 'after-the-refusal' })
    renderDetail('member-verified', client)
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('filing-change-text'))
    await userEvent.click(within(dialog()).getByTestId('message-checkbox'))
    await next()
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.queryByTestId('detail-decided-by-other')).toBeNull()
    expect(overviewLines()[0]).toBe('Mail text stays out, with the original')
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    await waitFor(() => expect(file).toHaveBeenCalledTimes(2))
    expect(file.mock.calls[1][1].mails[0]).toMatchObject({ ifMatch: 'after-the-refusal', message: null })
  })

  it('reads a mail under scan again until its attachments are clean, keeping what the person chose', async () => {
    const fixture = DETAIL_VARIANTS['scan-pending']
    const client = fixtureClient({ detail: fixture })
    const clean = { ...fixture.view, ifMatch: `${fixture.view.ifMatch}-scanned`, parts: fixture.view.parts.map((part) => ({ ...part, scan: part.kind === 'message' ? part.scan : ('clean' as const) })) }
    const get = vi.spyOn(client, 'get').mockResolvedValueOnce(fixture.view).mockResolvedValue(clean)
    renderDetail('scan-pending', client)
    expect(screen.getByTestId('status-scan-pending')).toBeInTheDocument()
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('filing-change-text'))
    await userEvent.click(within(dialog()).getByTestId('message-checkbox'))
    await waitFor(() => expect(screen.queryByTestId('status-scan-pending')).not.toBeInTheDocument())
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(within(dialog()).getByTestId('message-checkbox')).not.toBeChecked()
  })

  it('says a filing takes longer than usual after the quick rounds, and keeps asking', async () => {
    const fixture = DETAIL_VARIANTS['member-verified']
    const client = fixtureClient({ detail: fixture })
    const filing = { ...fixture.view, parts: fixture.view.parts.map((part) => ({ ...part, state: 'filing' as const })) }
    vi.spyOn(client, 'file').mockResolvedValue({ mails: [filing], filingJobId: 'job' })
    const get = vi.spyOn(client, 'get').mockResolvedValue(filing)
    renderDetail('member-verified', client)
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    expect(await screen.findByText('This takes longer than usual. Filing goes on; you can leave the mail.', {}, { timeout: 4000 })).toBeInTheDocument()
    const asked = get.mock.calls.length
    expect(asked).toBeGreaterThanOrEqual(FILING_QUICK_ROUNDS - 1)
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(asked))
  })
})

describe('the sender’s confirmation', () => {
  it('asks the member whose address the mail carries, and the whole row ticks it', async () => {
    renderDetail('own-unverified')
    await openFiling()
    expect(stepOf()).toBe('sender')
    expect(within(dialog()).getByRole('heading', { name: 'Did you send this mail?' })).toBeInTheDocument()
    expect(within(dialog()).getByTestId('filing-next')).toBeDisabled()
    await userEvent.click(within(dialog()).getByText('Yes, I sent this mail'))
    expect(within(dialog()).getByTestId('acknowledge-sender')).toBeChecked()
    expect(within(dialog()).getByTestId('acknowledge-sender-row').tagName).toBe('LABEL')
    expect(within(dialog()).getByTestId('filing-next')).toBeEnabled()
  })

  it('sends the confirmation with the decision', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['own-unverified'] })
    const file = vi.spyOn(client, 'file')
    renderDetail('own-unverified', client)
    await openFiling()
    await toOverview()
    await userEvent.click(within(dialog()).getByTestId('decision-file'))
    await waitFor(() => expect(file).toHaveBeenCalled())
    expect(file.mock.calls[0][1].mails[0].acknowledgeSender).toBe(true)
  })
})

describe('an impersonation', () => {
  it('is a stop: „Dismiss“ is the primary, „Review and file“ only behind „File anyway …“ and never primary', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS.impersonation })
    const dismiss = vi.spyOn(client, 'dismiss')
    renderDetail('impersonation', client)
    expect(screen.queryByTestId('decision-open')).toBeNull()
    expect(screen.queryByTestId('attachment-plan')).toBeNull()
    const discard = screen.getByTestId('decision-dismiss')
    expect(discard.className).toContain('order-last')
    expect(discard.className).toContain('bg-primary')
    const anyway = screen.getByTestId('impersonation-file-anyway')
    expect(anyway).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(anyway)
    expect(anyway).toHaveAttribute('aria-expanded', 'true')
    expect(anyway).toHaveTextContent('Close filing')
    const open = screen.getByTestId('decision-open')
    expect(open.className).not.toContain('bg-primary')
    expect(screen.getByTestId('decision-dismiss').className).toContain('bg-primary')
    await userEvent.click(screen.getByTestId('decision-dismiss'))
    await waitFor(() => expect(dismiss).toHaveBeenCalled())
  })

  it('offers nothing checked, asks the reader’s own phone-free yes first, and sends it', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS.impersonation })
    const file = vi.spyOn(client, 'file')
    renderDetail('impersonation', client)
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Your address, rejected by your domain')
    await userEvent.click(screen.getByTestId('impersonation-file-anyway'))
    expect(screen.getByTestId('inbound-mail-detail')).toHaveTextContent('Only if you sent this mail yourself.')
    await openFiling()
    expect(stepOf()).toBe('sender')
    expect(within(dialog()).getByTestId('acknowledge-sender-row')).toHaveTextContent(/^Yes, I sent this mail$/)
    await userEvent.click(within(dialog()).getByTestId('acknowledge-sender'))
    await next()
    expect(stepOf()).toBe('text')
    expect(within(dialog()).getByTestId('message-checkbox')).not.toBeChecked()
    await userEvent.click(within(dialog()).getByTestId('message-checkbox'))
    await next()
    expect(within(dialog()).getByTestId('attachment-checkbox')).not.toBeChecked()
    await next()
    const primary = within(dialog()).getByTestId('decision-file')
    expect(primary).toHaveTextContent('File')
    await userEvent.click(primary)
    await waitFor(() => expect(file).toHaveBeenCalled())
    expect(file.mock.calls[0][1].mails[0].acknowledgeSender).toBe(true)
  })

  it('gives the forged mail’s yes its own words and verb', async () => {
    renderDetail('member-name')
    const warning = screen.getByTestId('impersonation-warning')
    expect(warning).toHaveTextContent('Careful: the name Miriam Huber belongs to a member, the address miriam.huber@mail.example does not.')
    expect(warning).toHaveTextContent(`${PRODUCT_NAME} suggests nothing and nothing is preselected. Check payment or bank detail changes by phone, never by replying.`)
    expect(warning.compareDocumentPosition(screen.getByTestId('mail-header')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(warning.className).toMatch(/\bborder-danger\b/)
    expect(warning.className).not.toMatch(/border-l/)
    expect(warning.dataset.basis).toBe('member_name')
    await userEvent.click(screen.getByTestId('impersonation-file-anyway'))
    await openFiling()
    expect(within(dialog()).getByRole('heading', { name: 'Did you check by phone that the mail is genuine?' })).toBeInTheDocument()
    expect(within(dialog()).getByTestId('acknowledge-sender-row')).toHaveTextContent('I checked by phone that the mail is genuine')
    await userEvent.click(within(dialog()).getByTestId('acknowledge-sender'))
    await next()
    await userEvent.click(within(dialog()).getByTestId('message-checkbox'))
    await toOverview()
    expect(within(dialog()).getByTestId('decision-file')).toHaveTextContent('File as genuine')
  })

  it('pre-selects nothing and shows no suggestion of an impersonation, even when a stale view offers them', async () => {
    const suggested = DETAIL_VARIANTS['member-verified'].view.parts.find((part) => part.kind === 'attachment' && part.suggestion)?.suggestion ?? null
    expect(suggested).not.toBeNull()
    const base = DETAIL_VARIANTS.impersonation
    const stale = { ...base.view, parts: base.view.parts.map((part) => ({ ...part, preselected: true, suggestion: part.kind === 'attachment' ? suggested : null })) }
    render(
      <InboundMailDetail projectId={PROJECT_ID} mailId={stale.id} initial={stale} initialText={base.text} folders={FOLDERS} client={fixtureClient({ detail: { ...base, view: stale } })} onChanged={vi.fn()} now={FIXTURE_NOW} pollMs={1} />
    )
    await userEvent.click(screen.getByTestId('impersonation-file-anyway'))
    await openFiling()
    await userEvent.click(within(dialog()).getByTestId('acknowledge-sender'))
    await next()
    expect(within(dialog()).getByTestId('message-checkbox')).not.toBeChecked()
    await next()
    expect(within(dialog()).getByTestId('attachment-checkbox')).not.toBeChecked()
    await userEvent.click(within(dialog()).getByTestId('attachment-checkbox'))
    expect(screen.queryByText('The agent’s suggestion')).toBeNull()
    expect(within(dialog()).getByTestId('attachment-folder')).toHaveTextContent('Folder: none yet')
  })

  it('shows a colleague the forgery’s warning and „Dismiss …“ alone, with nothing to file and no way to try (B2, B4)', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['impersonation-colleague'] })
    const dismiss = vi.spyOn(client, 'dismiss')
    renderDetail('impersonation-colleague', client)
    expect(screen.getByTestId('impersonation-warning')).toHaveTextContent('Careful: this mail poses as Miriam Huber. The domain rejected it.')
    expect(screen.queryByTestId('impersonation-file-anyway')).toBeNull()
    expect(screen.queryByTestId('decision-open')).toBeNull()
    const discard = screen.getByTestId('decision-dismiss')
    expect(discard.className).toContain('bg-primary')
    await userEvent.click(discard)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Afterwards only Miriam Huber ‹m.huber@huber-architektur.at› can restore it, for 7 days.')
    expect(dismiss).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(dismiss).toHaveBeenCalled())
  })

  it('warns of nothing and folds nothing for a mail that poses as nobody', () => {
    renderDetail('external-unverified')
    expect(screen.queryByTestId('impersonation-warning')).toBeNull()
    expect(screen.queryByTestId('impersonation-file-anyway')).toBeNull()
    expect(screen.getByTestId('decision-open')).toBeInTheDocument()
  })
})

describe('the mail’s text and its follow', () => {
  it('prints a stranger’s markup as text, and a link as inert text', () => {
    const fixture = DETAIL_VARIANTS['member-verified']
    render(
      <InboundMailDetail
        projectId={PROJECT_ID}
        mailId={fixture.view.id}
        initial={fixture.view}
        initialText={text({ ownText: '<img src=x onerror="alert(1)"> https://evil.example/x', quoted: [] })}
        folders={FOLDERS}
        client={fixtureClient({ detail: fixture })}
        onChanged={vi.fn()}
      />
    )
    const own = screen.getByTestId('mail-text-own')
    expect(own.querySelector('img')).toBeNull()
    expect(own.querySelector('a')).toBeNull()
    expect(own).toHaveTextContent('<img src=x onerror="alert(1)">')
  })

  it('shows the extracted text and the attachment list, and no element of the mail’s markup anywhere', () => {
    const fixture = DETAIL_VARIANTS['external-unverified']
    const hostile = '<script>window.pwned = 1</script><style>body{display:none}</style><iframe src="https://evil.example"></iframe><img src="https://track.example/p.gif" width="1" height="1">'
    const { container } = render(
      <InboundMailDetail
        projectId={PROJECT_ID}
        mailId={fixture.view.id}
        initial={fixture.view}
        initialText={text({
          ownText: `Guten Tag,\n${hostile}\nanbei das Angebot.`,
          quoted: [{ header: `Am 1.10. schrieb <b>X</b>:`, text: hostile }],
          calendar: [{ summary: '<script>alert(1)</script>', start: null, end: null, allDay: false, location: '<img src=x>', status: null }],
        })}
        folders={FOLDERS}
        client={fixtureClient({ detail: fixture })}
        onChanged={vi.fn()}
        now={FIXTURE_NOW}
      />
    )
    expect(container.querySelector('script, style, iframe, object, embed, b')).toBeNull()
    expect(container.querySelector('img[src*="track.example"], img[src="x"], iframe[src*="evil.example"]')).toBeNull()
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()
    expect(screen.getByTestId('mail-text-own')).toHaveTextContent('<script>window.pwned = 1</script>')
    const attachment = screen.getByText('Angebot_2026.pdf').closest('li') as HTMLElement
    expect(attachment).toHaveTextContent(/PDF · 1[.,]\d+ MB/)
  })

  it('shows where a link goes and copies it, never opening it', async () => {
    const user = userEvent.setup()
    const fixture = DETAIL_VARIANTS['member-verified']
    const url = 'https://www.dropbox.com/s/abc/Plan.pdf?dl=0'
    render(
      <InboundMailDetail projectId={PROJECT_ID} mailId={fixture.view.id} initial={fixture.view} initialText={text({ ownText: `Die Pläne: ${url} danke`, quoted: [] })} folders={FOLDERS} client={fixtureClient({ detail: fixture })} onChanged={vi.fn()} now={FIXTURE_NOW} />
    )
    const link = screen.getByTestId('mail-text-link')
    expect(link.querySelector('a')).toBeNull()
    expect(within(link).getByTestId('mail-text-link-domain')).toHaveTextContent('→ dropbox.com')
    await user.click(within(link).getByRole('button', { name: `Copy: ${url}` }))
    expect(await navigator.clipboard.readText()).toBe(url)
  })

  it('says no follow in „Übersicht“ where a reply could never be filed without a click', async () => {
    renderDetail('external-unverified')
    await openFiling()
    await next()
    expect(within(dialog()).queryByTestId('filing-follow-note')).toBeNull()
  })

  it('offers the follow after the text was filed, for a sender who could qualify', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['follow-offer'] })
    const follow = vi.spyOn(client, 'follow')
    renderDetail('follow-offer', client)
    await userEvent.click(await screen.findByTestId('follow-offer-button'))
    await waitFor(() => expect(follow).toHaveBeenCalledWith(PROJECT_ID, expect.any(String)))
    expect(await screen.findByText('You follow “Stellplatznachweis”')).toBeInTheDocument()
  })

  it('offers no follow where a reply could never qualify', async () => {
    const fixture = DETAIL_VARIANTS['follow-offer']
    const view = { ...fixture.view, sender: { ...fixture.view.sender!, trust: 'external_unverified' as const, reason: 'dkim_none' as const } }
    const client = fixtureClient({ detail: { ...fixture, view } })
    const lookup = vi.spyOn(client, 'threadOfDocument')
    render(<InboundMailDetail projectId={PROJECT_ID} mailId={view.id} initial={view} initialText={fixture.text} folders={FOLDERS} client={client} onChanged={vi.fn()} />)
    await screen.findByTestId('message-filed')
    expect(lookup).not.toHaveBeenCalled()
    expect(screen.queryByTestId('follow-offer')).not.toBeInTheDocument()
  })

  it('confirms a follow in words, with the way out of it', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['follow-offer'] })
    const unfollow = vi.spyOn(client, 'unfollow')
    renderDetail('follow-offer', client)
    await userEvent.click(await screen.findByTestId('follow-offer-button'))
    expect(await screen.findByTestId('follow-offer-unfollow')).toHaveTextContent('Stop following')
    expect(screen.getByTestId('follow-offer-title')).toHaveTextContent('You follow “Stellplatznachweis”')
    expect(screen.getByTestId('follow-offer-hint')).toHaveTextContent('From now on, replies')
    await userEvent.click(screen.getByTestId('follow-offer-unfollow'))
    await waitFor(() => expect(unfollow).toHaveBeenCalled())
    expect(await screen.findByTestId('follow-offer-button')).toBeInTheDocument()
  })
})
