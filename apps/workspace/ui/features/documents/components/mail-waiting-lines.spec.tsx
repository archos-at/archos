import { render, screen } from '@/test-utils'
import { describe, expect, test } from 'vitest'
import { InboundMailWaitingLine } from './inbound-mail-waiting-line'
import { MailImportLine } from './mail-import-line'

// Both lines arrive after their count is fetched, so they appear on every switch into a project that has one:
// arrival by navigation fades on `duration-snap` (120ms), never on the content-entrance step.
describe('the mail lines under the Dateien head and the new-chat composer', () => {
  test('the waiting line fades in on one short step', () => {
    render(<InboundMailWaitingLine href="/app/projects/p/files/mail" count={2} more={false} />)
    const line = screen.getByTestId('inbound-mail-waiting-line')
    expect(line).toHaveClass('animate-in', 'fade-in-0', 'duration-snap', 'ease-out', 'motion-reduce:animate-none')
    expect(line.className).not.toMatch(/duration-(base|quick|deliberate)|slide-in-from/)
  })

  test('the import line fades in on one short step', () => {
    render(
      <MailImportLine
        state={{ list: null, sending: { importId: 'i1', filename: 'Postfach.pst' } } as never}
        onOpen={() => {}}
      />
    )
    const line = screen.getByTestId('mail-import-line')
    expect(line).toHaveClass('animate-in', 'fade-in-0', 'duration-snap', 'ease-out', 'motion-reduce:animate-none')
    expect(line.className).not.toMatch(/duration-(base|quick|deliberate)|slide-in-from/)
  })
})
