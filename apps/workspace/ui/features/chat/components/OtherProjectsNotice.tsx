import { useId, type FC } from 'react'
import { FolderSymlink } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { RestrictingOtherProject } from '@/adapters/api/conversations-client'

export interface OtherProjectsNoticeProps {
  projects: readonly RestrictingOtherProject[]
}

export const OtherProjectsNotice: FC<OtherProjectsNoticeProps> = ({ projects }) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const titleId = useId()
  const bodyId = useId()
  if (projects.length === 0) return null
  const names = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    projects.map((project) => project.name ?? t('otherProjects.gone'))
  )
  return (
    <div className="mt-2 flex" data-testid="other-projects-notice">
      <Popover>
        <PopoverTrigger asChild>
          <Chip asChild variant="muted" size="sm" interactive aria-label={t('otherProjects.title', { projects: names })}>
            <button type="button">
              <FolderSymlink aria-hidden="true" />
              {t('otherProjects.chip', { count: projects.length })}
            </button>
          </Chip>
        </PopoverTrigger>
        {/* Radix's dialog role, named and described by the two lines it shows. */}
        <PopoverContent
          align="start"
          className="w-80 space-y-1.5 p-4"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          <p id={titleId} className="text-sm font-medium text-foreground">
            {t('otherProjects.title', { projects: names })}
          </p>
          <p id={bodyId} className="text-xs leading-relaxed text-muted-foreground">
            {t('otherProjects.body')}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
