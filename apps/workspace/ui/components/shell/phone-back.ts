export interface PhoneBackTarget {
  href: string
  sectionKey: 'settings'
}

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function phoneBackTarget(pathname: string, projectId: string): PhoneBackTarget | null {
  const base = `/app/projects/${projectId}`
  if (pathname.startsWith(`${base}/settings/`)) return { href: `${base}/settings`, sectionKey: 'settings' }
  if (isUnder(pathname, `${base}/setup`) || isUnder(pathname, `${base}/intake`)) {
    return { href: `${base}/settings`, sectionKey: 'settings' }
  }
  return null
}
