/**
 * The refusal of a switched-off feature, thrown from a service. Its own
 * module so `feature-disabled.ts`, which every route's `requireFeature`
 * reaches, stays a leaf that imports nothing (blast radius).
 */

import { ApiError } from '@/lib/api/api-error'
import { featureDisabledProblem } from './feature-disabled'

/**
 * The same refusal thrown from a service, where a route's `requireFeature`
 * cannot answer (a message that mentions someone while collaboration is off):
 * the handler renders its problem as `requireFeature` does, so a switched-off
 * feature refuses in one shape wherever it is found off.
 */
export class FeatureDisabledError extends ApiError {
  readonly problem: ReturnType<typeof featureDisabledProblem>

  constructor(readonly feature: string) {
    const problem = featureDisabledProblem(feature)
    super(403, problem.code, problem.detail)
    this.problem = problem
  }
}
