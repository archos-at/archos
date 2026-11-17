import type { JSX } from 'react'
import { SimilarProjects } from '@/features/references/components/similar-projects'
import { EMPTY_SIMILAR_PAGE, SIMILAR_PAGE } from '../_fixtures/similar-projects'

export default function SimilarProjectsPreview(): JSX.Element {
  return (
    <div className="flex flex-col gap-10">
      <SimilarProjects projectId="preview" page={SIMILAR_PAGE} />
      <SimilarProjects projectId="preview" page={EMPTY_SIMILAR_PAGE} />
    </div>
  )
}
