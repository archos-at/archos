/**
 * The refusal of a switched-off feature (`requireFeature`): one RFC 9457
 * problem for every switch, so a client and an agent branch on `code` and read
 * what turns it on from `detail`. Pure.
 */

/** The problem type of a switched-off feature. */
export const FEATURE_DISABLED_PROBLEM_TYPE = 'urn:problem-type:feature-disabled'

/**
 * `type`, `title`, `status`, `code: feature_disabled`, `detail` naming the
 * switch and what turns it on, the extension member `feature` (the slug), and
 * `error` (the same sentence, the field every other route of this app answers with).
 */
export function featureDisabledProblem(flag: string) {
  const detail = `The ${flag} feature is not switched on for this organization; a platform operator switches it on per organization (feature flag \`${flag}\`).`
  return { type: FEATURE_DISABLED_PROBLEM_TYPE, title: 'Forbidden', status: 403, code: 'feature_disabled', detail, error: detail, feature: flag }
}
