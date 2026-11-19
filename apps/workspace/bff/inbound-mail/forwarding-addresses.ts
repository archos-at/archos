import { z } from 'zod'

export const INBOUND_MAIL_FORWARDED_FROM_MAX = 10

const MAX_ADDRESS_LENGTH = 254

const ADDRESS = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/

export type ForwardingAddressProblem = 'malformed' | 'project_address' | 'too_many'

export function normalizeForwardingAddress(address: string): string {
  return address.trim().replace(/^<|>$/g, '').replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function isOnInboundDomain(address: string, inboundDomain: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1)
  const ours = normalizeForwardingAddress(inboundDomain)
  return ours !== '' && (domain === ours || domain.endsWith(`.${ours}`))
}

export function forwardingAddressProblem(address: string, inboundDomain: string | null): ForwardingAddressProblem | null {
  const normalized = normalizeForwardingAddress(address)
  if (normalized.length > MAX_ADDRESS_LENGTH || !ADDRESS.test(normalized)) return 'malformed'
  if (inboundDomain && isOnInboundDomain(normalized, inboundDomain)) return 'project_address'
  return null
}

export function forwardingAddressesOf(addresses: readonly string[]): string[] {
  return [...new Set(addresses.map(normalizeForwardingAddress).filter((address) => address !== ''))]
}

export function forwardingListProblem(addresses: readonly string[], inboundDomain: string | null): ForwardingAddressProblem | null {
  const list = forwardingAddressesOf(addresses)
  if (list.length > INBOUND_MAIL_FORWARDED_FROM_MAX) return 'too_many'
  return list.map((address) => forwardingAddressProblem(address, inboundDomain)).find((problem) => problem !== null) ?? null
}

export const inboundMailForwardedFromBodySchema = z
  .object({
    forwardedFrom: z
      .array(z.string().max(MAX_ADDRESS_LENGTH))
      .max(INBOUND_MAIL_FORWARDED_FROM_MAX)
      .describe(
        `The office’s existing addresses for this project (projekt-x@buero.at) that forward to the project address by a rule, at most ${INBOUND_MAIL_FORWARDED_FROM_MAX}. Replaces the list; [] clears it.`,
      ),
  })
  .strict()
export type InboundMailForwardedFromBody = z.infer<typeof inboundMailForwardedFromBodySchema>
