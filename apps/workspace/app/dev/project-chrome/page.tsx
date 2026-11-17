'use client'

import type { JSX } from 'react'
import type { ReactNode } from 'react'

import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { SectionLabel } from '@/components/ui/section-label'
import { PRODUCT_NAME } from '@/lib/brand'

function Chrome({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}): JSX.Element {
  return <PageHeader title={title} subtitle={subtitle} action={action} />
}

function Group({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-6">
      <SectionLabel>{label}</SectionLabel>
      <div className="space-y-10">{children}</div>
    </section>
  )
}

export default function ProjectChromePreviewPage(): JSX.Element {
  return (
    <main data-testid="project-chrome-preview" className="bg-background space-y-12 p-8 text-foreground">
      <Group label="Work">
        <Chrome
          title="Files"
          subtitle={"The project’s files: documents, drawings and reports, read by " + PRODUCT_NAME + " and cited where it uses them."}
          action={<Button type="button">Upload</Button>}
        />
        <Chrome
          title="History"
          subtitle="Every conversation and deep-research run in this project."
          action={
            <SearchField
              type="text"
              className="w-full sm:w-64"
              value=""
              onChange={() => undefined}
              placeholder="Search history…"
              label="Search conversations by title"
            />
          }
        />
      </Group>

      <Group label="Automate">
        <Chrome
          title="Jobs"
          subtitle="Prompts this project runs on a timer."
          action={
            <Button type="button" size="sm">
              <Plus className="size-4" aria-hidden />
              New job
            </Button>
          }
        />
        <Chrome
          title="Skills"
          subtitle="Reusable instructions the organization writes once."
          action={
            <Button type="button" size="sm">
              <Plus className="size-4" aria-hidden />
              New skill
            </Button>
          }
        />
      </Group>

      <Group label="Project">
        <Chrome
          title="Knowledge"
          subtitle="What the knowledge base currently contains."
        />
        <Chrome
          title="Settings"
          subtitle="Project profile, members, memory, and danger zone."
        />
        <Chrome
          title="Setup"
          subtitle="Guided briefing for this project."
        />
      </Group>

      <Group label="Organization">
        <Chrome
          title="Office filing"
          subtitle="Shared documents available to every project in your organization"
        />
        <Chrome
          title="Inbox"
          subtitle="Requests and updates from your team."
        />
      </Group>
    </main>
  )
}
