import { ApiError } from '@/lib/api/api-error'
import { featureDisabledProblem } from './feature-disabled'

export class FeatureDisabledError extends ApiError {
  readonly problem: ReturnType<typeof featureDisabledProblem>

  constructor(readonly feature: string) {
    const problem = featureDisabledProblem(feature)
    super(403, problem.code, problem.detail)
    this.problem = problem
  }
}
