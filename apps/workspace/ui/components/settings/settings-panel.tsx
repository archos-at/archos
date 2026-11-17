import type { JSX, ReactNode } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function SettingsPanel({
  title,
  description,
  action,
  children,
  'data-testid': testId,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  'data-testid'?: string
}): JSX.Element {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  )
}

export function SettingsSectionIntro({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}): JSX.Element {
  return (
    <div className="space-y-1">
      <h2 className="text-foreground text-sm font-medium">{title}</h2>
      {description ? (
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">{description}</p>
      ) : null}
    </div>
  )
}
