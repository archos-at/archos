import type { JSX } from 'react'
import { Suspense } from 'react'
import { QualityWorkspace } from '@/features/platform/components/quality-workspace'

export default function PlatformQualityPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <QualityWorkspace />
    </Suspense>
  )
}
