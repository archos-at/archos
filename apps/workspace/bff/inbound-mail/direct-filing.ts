export function directFilingEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.INBOUND_MAIL_DIRECT_FILING ?? '').trim().toLowerCase() !== 'false'
}
