/**
 * An email address that wraps where a reader expects it to.
 *
 * A project's address is long (`project+bauplatz-12.k3x7q2m9p4ab@inbox.example.org`)
 * and has no spaces, so on a phone it has to wrap somewhere. Broken anywhere,
 * it split mid-word (`…@inbox.e` / `xample.org`), and a reader could no longer
 * tell where the domain began. So the address carries its own break
 * opportunities, the typographic convention for addresses: after a `+`, before
 * a `.` of the local part, and before the `@`, which keeps the domain whole.
 * A slug's hyphens break by themselves. Only a single segment wider than the
 * line still breaks inside, through `overflow-wrap: anywhere` on whatever
 * holds it.
 *
 * Text only: the parent decides font, colour and the fallback wrap.
 */

import { Fragment, type JSX } from 'react'

/** The address cut where a line may end: after each piece but the last. */
export function emailAddressSegments(address: string): string[] {
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  // After each `+`, before each `.`: zero-width splits, so no character is lost.
  const segments = local.split(/(?<=\+)|(?=\.)/).filter((segment) => segment !== '')
  if (at !== -1) segments.push(address.slice(at))
  return segments
}

export function EmailAddress({ address }: { address: string }): JSX.Element {
  let offset = 0
  const segments = emailAddressSegments(address).map((text) => {
    // Its offset in the address: unique, where a segment's text may repeat.
    const segment = { text, at: offset }
    offset += text.length
    return segment
  })
  return (
    <>
      {segments.map(({ text, at }) => (
        <Fragment key={at}>
          {text}
          {at + text.length < address.length && <wbr />}
        </Fragment>
      ))}
    </>
  )
}
