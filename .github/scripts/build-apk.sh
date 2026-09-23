#!/usr/bin/env bash
set -euo pipefail

: "${TOOLS_DIR:?Set TOOLS_DIR to the directory containing apk}"
TOOLS_DIR=$(cd "$TOOLS_DIR" && pwd)
: "${DATA:?Source package-common.sh first}"

{ printf '#!/bin/sh\nexport PKG_UPGRADE=1\n'; tail -n +2 "$HOOKS/postinst"; } > "$HOOKS/post-upgrade"
mkdir -p "$DATA/lib/apk/packages"
(cd "$DATA"; find . -type f -printf '/%P\n' | sort) > "$WORK/$NAME.list"
install -m 0644 "$WORK/$NAME.list" "$DATA/lib/apk/packages/$NAME.list"
printf '/etc/config/cake_tiny\n' > "$DATA/lib/apk/packages/$NAME.conffiles"
printf '/etc/config/cake_tiny %s\n' "$(sha256sum "$DATA/etc/config/cake_tiny" | cut -d' ' -f1)" \
  > "$DATA/lib/apk/packages/$NAME.conffiles_static"
fakeroot "$TOOLS_DIR/apk" mkpkg \
  --info "name:$NAME" --info "version:$VERSION" --info "arch:noarch" \
  --info "license:$LICENSE" --info "origin:$NAME" \
  --info "url:$PACKAGE_URL" \
  --info "description:$DESCRIPTION" --info "depends:$DEPENDS" \
  --script "post-install:$HOOKS/postinst" \
  --script "post-upgrade:$HOOKS/post-upgrade" \
  --script "pre-deinstall:$HOOKS/prerm" \
  --files "$DATA" --output "$DIST/$NAME-$VERSION.apk"
