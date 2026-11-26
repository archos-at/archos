const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'a1.net',
  'aon.at',
  'arcor.de',
  'bluewin.ch',
  'chello.at',
  'email.de',
  'freenet.de',
  'gmail.com',
  'googlemail.com',
  'gmx.at',
  'gmx.ch',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'hispeed.ch',
  'icloud.com',
  'inode.at',
  'kabsi.at',
  'mac.com',
  'mail.com',
  'mail.de',
  'mail.ru',
  'mailbox.org',
  'me.com',
  'msn.com',
  'online.de',
  'pm.me',
  'posteo.at',
  'posteo.de',
  'proton.me',
  'protonmail.com',
  'sunrise.ch',
  't-online.de',
  'tele2.at',
  'tuta.io',
  'tutanota.com',
  'utanet.at',
  'web.de',
  'yandex.com',
  'ymail.com',
  'zoho.com',
])

const PUBLIC_MAIL_FAMILIES = /^(?:yahoo|gmx|hotmail|outlook|live|aol)\.(?:[a-z]{2,3}\.)?[a-z]{2,}$/u

export function isPublicMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  const normalized = domain.trim().toLowerCase().replace(/\.$/u, '')
  return PUBLIC_MAIL_DOMAINS.has(normalized) || PUBLIC_MAIL_FAMILIES.test(normalized)
}
