import 'server-only'

import type { UserSession } from '@/lib/auth/types'
import { FEATURE_FLAGS, isFeatureEnabled, isIfcModelsEnabled } from '@/lib/authz/feature-flags'
import { enabledFlagsForOrganization } from '@/lib/workos/feature-flags'
import { acceptedUploadExtensions, uploadExtensionOf } from '@/shared/config/file-upload'
import { isVlmConfigured } from './vlm-capability'

export function acceptedTypesForFlags(flags: Pick<UserSession, 'featureFlags'>, vlmAvailable: boolean): readonly string[] {
  return acceptedUploadExtensions({
    imageUploadEnabled: isFeatureEnabled(flags, FEATURE_FLAGS.imageUpload),
    vlmAvailable,
    ifcUploadEnabled: isIfcModelsEnabled(flags),
  })
}

export async function acceptedTypesForOrganization(organizationId: string): Promise<readonly string[]> {
  const [featureFlags, vlmAvailable] = await Promise.all([
    enabledFlagsForOrganization(organizationId),
    isVlmConfigured(),
  ])
  return acceptedTypesForFlags({ featureFlags }, vlmAvailable)
}

export function isAcceptedType(fileName: string, accepted: readonly string[]): boolean {
  const extension = uploadExtensionOf(fileName)
  return extension !== '' && accepted.includes(extension)
}
