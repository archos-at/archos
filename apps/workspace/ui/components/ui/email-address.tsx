import { Fragment, type JSX } from 'react'

export function emailAddressSegments(address: string): string[] {
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  const segments = local.split(/(?<=\+)|(?=\.)/).filter((segment) => segment !== '')
  if (at !== -1) segments.push(address.slice(at))
  return segments
}

export function EmailAddress({ address }: { address: string }): JSX.Element {
  let offset = 0
  const segments = emailAddressSegments(address).map((text) => {
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
