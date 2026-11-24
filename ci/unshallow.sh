#!/usr/bin/env bash
# The one place a clone is unshallowed. `git fetch --unshallow` aborts on a
# complete clone, and an earlier step (reno's lint, a deepened merge-base
# search reaching the root) may already have completed it.
#
# Usage: ci/unshallow.sh [git fetch options...]
set -euo pipefail

if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  git fetch --quiet --unshallow "$@" origin
fi
