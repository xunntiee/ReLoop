#!/bin/bash

PACKAGE_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
"${PACKAGE_ROOT}/_tool-runtime/stop-local-web.sh"
STATUS=$?
if ((STATUS != 0)); then
  printf '\nNhan Enter de dong cua so nay...'
  read -r
fi
exit "${STATUS}"
