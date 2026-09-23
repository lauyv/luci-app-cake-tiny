#!/usr/bin/env bash
set -euo pipefail

: "${GH_REPO:?Set GH_REPO to owner/repository}"
: "${BUILD_SHA:?Set BUILD_SHA to the commit being packaged}"
: "${NOTES_FILE:?Set NOTES_FILE to the release description file}"

RELEASES_FILE=$(mktemp)
trap 'rm -f -- "$RELEASES_FILE"' EXIT
gh api --paginate "repos/$GH_REPO/releases?per_page=100" \
  --jq '.[] | select(.draft == false and any(.assets[]; .name | test("^luci-app-cake-tiny[-_].*\\.(apk|ipk)$"))) | [.published_at, .tag_name] | @tsv' \
  > "$RELEASES_FILE"
PREVIOUS_TAG=$(LC_ALL=C sort -r "$RELEASES_FILE" | awk -F '\t' 'NR == 1 { print $2 }')

COMMIT_RANGE="$BUILD_SHA"
if [[ -n "$PREVIOUS_TAG" ]]; then
  PREVIOUS_COMMIT=$(git rev-parse --verify "refs/tags/$PREVIOUS_TAG^{commit}")
  COMMIT_RANGE="$PREVIOUS_COMMIT..$BUILD_SHA"
fi
git log --reverse --format='%B' "$COMMIT_RANGE" -- > "$NOTES_FILE"

shopt -s nullglob
APK_FILES=(dist/luci-app-cake-tiny-*.apk)
IPK_FILES=(dist/luci-app-cake-tiny_*.ipk)
[[ ${#APK_FILES[@]} -eq 1 && ${#IPK_FILES[@]} -eq 1 ]] || {
  echo "Expected exactly one APK and one IPK in dist" >&2
  exit 1
}
APK_NAME=$(basename -- "${APK_FILES[0]}")
IPK_NAME=$(basename -- "${IPK_FILES[0]}")
cat >> "$NOTES_FILE" <<EOF

Install:
ImmortalWrt 25.12 (APK):
apk add --allow-untrusted ./$APK_NAME

OpenWrt with opkg (IPK):
opkg install ./$IPK_NAME

/etc/init.d/rpcd restart
EOF
