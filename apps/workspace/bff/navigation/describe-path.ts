import type { ProjectSectionKey } from '@/components/shell/project-sections'

export interface PathLabel {
  namespace: 'nav' | 'collaboration'
  key: string
}

const PROJECT_SECTION_SEGMENTS: readonly ProjectSectionKey[] = [
  'chat',
  'files',
  'knowledge',
  'automation',
  'intake',
  'settings',
]

const EXTRA_PROJECT_SEGMENTS: Record<string, PathLabel> = {
  research: { namespace: 'nav', key: 'sections.research' },
  setup: { namespace: 'nav', key: 'sections.setup' },
  members: { namespace: 'nav', key: 'returnTargets.members' },
  model: { namespace: 'nav', key: 'returnTargets.model' },
  referenzen: { namespace: 'nav', key: 'sections.referenzen' },
}

const APP_SECTIONS: Record<string, PathLabel> = {
  'office-shelf': { namespace: 'nav', key: 'sections.officeShelf' },
  'base-knowledge': { namespace: 'nav', key: 'sections.baseKnowledge' },
  archiv: { namespace: 'nav', key: 'sections.officeShelf' },
  inbox: { namespace: 'collaboration', key: 'inbox.navLabel' },
  organization: { namespace: 'nav', key: 'returnTargets.organization' },
  platform: { namespace: 'nav', key: 'returnTargets.platform' },
  profile: { namespace: 'nav', key: 'returnTargets.profile' },
  chat: { namespace: 'nav', key: 'sections.chat' },
}

export function describeAppPath(path: string): PathLabel | null {
  const segments = path.split('?')[0].split('/').filter(Boolean)
  if (segments[0] !== 'app') return null

  if (segments[1] === 'projects') {
    if (segments.length === 2) return { namespace: 'nav', key: 'projectSwitcher.projects' }
    if (segments.length === 3) return { namespace: 'nav', key: 'returnTargets.project' }

    const segment = segments[3]
    if ((PROJECT_SECTION_SEGMENTS as readonly string[]).includes(segment)) {
      return { namespace: 'nav', key: `sections.${segment}` }
    }
    return EXTRA_PROJECT_SEGMENTS[segment] ?? { namespace: 'nav', key: 'returnTargets.project' }
  }

  return APP_SECTIONS[segments[1] ?? ''] ?? null
}
