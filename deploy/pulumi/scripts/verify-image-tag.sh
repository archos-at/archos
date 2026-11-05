#!/usr/bin/env bash
# Fail unless ghcr.io/<owner>/grid-oib-{backend,frontend,web}:<tag> all exist,
# and ghcr.io/<owner>/cms:<tag> too when CMS_ENABLED=true (the stack runs the
# CMS, which pulls the same tag as the others).
#
# Usage: [CMS_ENABLED=true] verify-image-tag.sh <owner> <tag>
# Needs GITHUB_ACTOR and GH_TOKEN (a token with `packages: read`).
#
# The registry lookup itself is `find-published-tag.sh` beside this, which the
# staging resolver (`resolve-image-refs.sh`) shares.
#
# Both deploy jobs call this. Prod used not to: it pinned tags that the old
# incremental publish had never built (a changelog-only commit built only
# grid-oib-web), the new pods sat in ImagePullBackOff behind maxUnavailable: 0,
# and the old pods kept serving a pre-fix image while the fixes were marked
# shipped (#653's traceback on 09-18 and 09-21 still had the old line numbers).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
owner="${1:?owner}"
tag="${2:?tag}"

case "$tag" in
  sha-[0-9a-f]*|v[0-9]*|latest) ;;
  *) echo "::error::refusing to look up image tag '$tag': not sha-<hex>, v* or latest"; exit 1 ;;
esac

images=(backend frontend web)
[ "${CMS_ENABLED:-}" = "true" ] && images+=(cms)
for service in "${images[@]}"; do
  repository="grid-oib-${service}"
  [ "$service" = cms ] && repository=cms
  rc=0
  REPOSITORY="$repository" "$here/find-published-tag.sh" "$owner" "$service" "$tag" >/dev/null || rc=$?
  case "$rc" in
    0) ;;
    1)
      echo "::error::image tag '${tag}' is not published for ${repository}. Pick the sha- tag of a develop commit whose CI run passed: CI tags every image only then."
      exit 1
      ;;
    *)
      echo "::error::could not check image tag '${tag}' for ${repository} (see the registry error above)."
      exit 1
      ;;
  esac
done
echo "image tag '${tag}' verified for ${images[*]}"
