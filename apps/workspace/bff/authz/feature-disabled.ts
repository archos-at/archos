export const FEATURE_DISABLED_PROBLEM_TYPE = 'urn:problem-type:feature-disabled'

export function featureDisabledProblem(flag: string) {
  const detail = `The ${flag} feature is not switched on for this organization; a platform operator switches it on per organization (feature flag \`${flag}\`).`
  return { type: FEATURE_DISABLED_PROBLEM_TYPE, title: 'Forbidden', status: 403, code: 'feature_disabled', detail, error: detail, feature: flag }
}
