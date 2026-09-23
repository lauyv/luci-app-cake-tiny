#!/usr/bin/env bash
# Shared release metadata and payload for the APK and IPK builders.
set -euo pipefail

: "${RELEASE_TAG:?Set RELEASE_TAG, for example v0.1.0}"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY to owner/repository}"
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Release tag must be vMAJOR.MINOR.PATCH" >&2
  exit 1
}

SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
NAME=luci-app-cake-tiny
DESCRIPTION='Minimal tc + IFB + CAKE shaper for LuCI'
PACKAGE_URL="https://github.com/$GITHUB_REPOSITORY"
DIST="$SOURCE_DIR/dist"
RELEASE=$(sed -n 's/^PKG_RELEASE:=//p' "$SOURCE_DIR/Makefile")
[[ "$RELEASE" =~ ^[0-9]+$ ]] || { echo "Invalid PKG_RELEASE" >&2; exit 1; }
VERSION="${RELEASE_TAG#v}-r$RELEASE"
DEPENDS=$(sed -n 's/^LUCI_DEPENDS:=//p' "$SOURCE_DIR/Makefile" | tr -d '+')
LICENSE=$(sed -n 's/^PKG_LICENSE:=//p' "$SOURCE_DIR/Makefile")
[[ -n "$DEPENDS" && -n "$LICENSE" ]] || { echo "Missing package metadata" >&2; exit 1; }

WORK=$(mktemp -d "${RUNNER_TEMP:-/tmp}/cake-tiny-package.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
DATA="$WORK/data"
HOOKS="$WORK/hooks"
mkdir -p "$DATA/www" "$HOOKS" "$DIST"
cp -R "$SOURCE_DIR/root/." "$DATA/"
cp -R "$SOURCE_DIR/htdocs/." "$DATA/www/"
find "$DATA" -type d -exec chmod 0755 {} +
find "$DATA" -type f -exec chmod 0644 {} +
chmod 0755 \
  "$DATA/etc/init.d/cake-tiny" \
  "$DATA/etc/hotplug.d/iface/95-cake-tiny" \
  "$DATA/etc/hotplug.d/net/95-cake-tiny" \
  "$DATA/usr/libexec/cake-tiny-status"

# Use LuCI's own po2lmo compiler, matching the 25.12 release branch.
LUCI_SOURCE="$WORK/luci"
git clone --quiet --depth 1 --filter=blob:none --sparse --branch openwrt-25.12 \
  https://github.com/openwrt/luci.git "$LUCI_SOURCE"
git -C "$LUCI_SOURCE" sparse-checkout set modules/luci-base/src
make -s -C "$LUCI_SOURCE/modules/luci-base/src" po2lmo
mkdir -p "$DATA/usr/lib/lua/luci/i18n"
"$LUCI_SOURCE/modules/luci-base/src/po2lmo" \
  "$SOURCE_DIR/po/zh_Hans/cake-tiny.po" \
  "$DATA/usr/lib/lua/luci/i18n/cake-tiny.zh-cn.lmo"

cat > "$HOOKS/postinst" <<'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT:-}" = 1 ] && exit 0
[ -s "${IPKG_INSTROOT}/lib/functions.sh" ] || exit 0
. "${IPKG_INSTROOT}/lib/functions.sh"
export root="${IPKG_INSTROOT}"
export pkgname="luci-app-cake-tiny"
default_postinst
[ -n "$IPKG_INSTROOT" ] || {
  rm -f /tmp/luci-indexcache.*
  rm -rf /tmp/luci-modulecache/
  /etc/init.d/rpcd reload 2>/dev/null
}
exit 0
EOF

cat > "$HOOKS/prerm" <<'EOF'
#!/bin/sh
[ -s "${IPKG_INSTROOT}/lib/functions.sh" ] || exit 0
. "${IPKG_INSTROOT}/lib/functions.sh"
export root="${IPKG_INSTROOT}"
export pkgname="luci-app-cake-tiny"
default_prerm
EOF
chmod 0755 "$HOOKS/postinst" "$HOOKS/prerm"
