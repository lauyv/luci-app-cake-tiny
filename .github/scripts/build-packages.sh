#!/usr/bin/env bash
set -euo pipefail

# Build the payload once, then package the same files for APK and IPK.
source "$(dirname -- "${BASH_SOURCE[0]}")/package-common.sh"
source "$(dirname -- "${BASH_SOURCE[0]}")/build-ipk.sh"
source "$(dirname -- "${BASH_SOURCE[0]}")/build-apk.sh"
